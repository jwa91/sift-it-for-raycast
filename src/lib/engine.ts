import { ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { useEffect, useState } from "react";
import { siftBinary } from "./sift";

/** An event from `sift-it serve` (a line without an id). */
export interface EngineEvent {
  event: "ready" | "encoder" | "exit";
  state?: "ready" | "unavailable";
  error?: string;
  vectors?: number;
}

type Waiting = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * `sift-it serve`, the searcher as a process: it keeps the vectors in memory and the query encoder loaded while the
 * command is open. One JSON request per line in, one reply per line out with the request's id.
 */
export class Engine {
  private child: ChildProcess;
  private nextId = 1;
  private waiting = new Map<number, Waiting>();
  private handlers = new Set<(event: EngineEvent) => void>();
  private stderr = "";

  constructor(binary: string) {
    this.child = spawn(binary, ["serve"], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.child.stdout! }).on("line", (line) => this.receive(line));
    this.child.stderr!.on("data", (data: Buffer) => {
      this.stderr = (this.stderr + data.toString()).slice(-4000);
    });
    this.child.on("exit", (code) => {
      const error = new Error(this.stderr.trim().split("\n").pop() || `the engine stopped (${code})`);
      this.waiting.forEach(({ reject }) => reject(error));
      this.waiting.clear();
      this.handlers.forEach((handler) => handler({ event: "exit", error: error.message }));
    });
    this.child.on("error", (error) => {
      this.handlers.forEach((handler) => handler({ event: "exit", error: error.message }));
    });
  }

  private receive(line: string) {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const id = message.id;
    if (typeof id === "number" && this.waiting.has(id)) {
      const { resolve, reject } = this.waiting.get(id)!;
      this.waiting.delete(id);
      if (message.ok === false) reject(new Error(String(message.error ?? "the engine failed")));
      else resolve(message);
    } else if (typeof message.event === "string") {
      this.handlers.forEach((handler) => handler(message as unknown as EngineEvent));
    }
  }

  request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child.stdin!.write(JSON.stringify({ ...params, id, op }) + "\n");
    });
  }

  onEvent(handler: (event: EngineEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close() {
    this.child.stdin?.end();
    setTimeout(() => this.child.kill(), 2000).unref?.();
  }
}

export interface EngineState {
  engine?: Engine;
  /** The index is open: words-only searches work. */
  ready: boolean;
  /** The query encoder is loaded: searches use meaning too. */
  meaning: boolean;
  error?: string;
  missing?: boolean;
}

/** Starts `sift-it serve` for as long as the command is open. */
export function useEngine(): EngineState {
  const [state, setState] = useState<EngineState>({ ready: false, meaning: false });
  useEffect(() => {
    const binary = siftBinary();
    if (!binary) {
      setState({ ready: false, meaning: false, missing: true });
      return;
    }
    const engine = new Engine(binary);
    setState({ engine, ready: false, meaning: false });
    const off = engine.onEvent((event) => {
      setState((state) => {
        switch (event.event) {
          case "ready":
            return { ...state, ready: true };
          case "encoder":
            return event.state === "ready"
              ? { ...state, meaning: true }
              : { ...state, meaning: false, error: event.error ?? "the model couldn't load" };
          case "exit":
            return { ...state, ready: false, meaning: false, error: event.error };
        }
      });
    });
    return () => {
      off();
      engine.close();
    };
  }, []);
  return state;
}
