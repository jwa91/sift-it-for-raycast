import { ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { useEffect, useState } from "react";
import { siftBinary } from "./sift";

/** Whether search by meaning can be had: the engine loads its model and vectors for the first such search. */
export type MeaningState = "unloaded" | "loading" | "ready" | "unavailable";

/**
 * An event from the engine, through `sift-it serve` (a line without an id): `ready` on connecting (again, after the
 * engine was restarted), `meaning` when its state changes, `exit` when serve itself stopped.
 */
export interface EngineEvent {
  event: "ready" | "meaning" | "config" | "exit";
  /** On ready. */
  meaning?: MeaningState;
  /** On meaning. */
  state?: MeaningState;
  error?: string;
}

type Waiting = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * `sift-it serve`, the way to the engine: one resident process that keeps what it loaded (the model and the vectors)
 * between commands. One JSON request per line in, one reply per line out with the request's id.
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
  /** The engine answers: searches by words work. */
  ready: boolean;
  /** The model and the vectors are loaded: searches use meaning too. */
  meaning: boolean;
  error?: string;
  missing?: boolean;
}

/** Starts `sift-it serve` for as long as the command is open (the engine behind it stays). */
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
            return { ...state, ready: true, meaning: event.meaning === "ready", error: undefined };
          case "meaning":
            return event.state === "unavailable"
              ? { ...state, meaning: false, error: event.error ?? "the model couldn't load" }
              : { ...state, meaning: event.state === "ready" };
          case "config":
            return state;
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
