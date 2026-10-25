// Draws the extension's icon into assets/icon.png (512 px).
//   swift scripts/make-icons.swift
import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent()
let assets = root.appendingPathComponent("assets")
try FileManager.default.createDirectory(at: assets, withIntermediateDirectories: true)

func png(_ size: Int, _ draw: (CGRect) -> Void) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(CGRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

func symbol(_ name: String, pointSize: CGFloat, color: NSColor) -> NSImage {
    let configuration = NSImage.SymbolConfiguration(pointSize: pointSize, weight: .semibold)
        .applying(NSImage.SymbolConfiguration(paletteColors: [color]))
    return NSImage(systemSymbolName: name, accessibilityDescription: nil)!.withSymbolConfiguration(configuration)!
}

func drawCentered(_ image: NSImage, in rect: CGRect) {
    let size = image.size
    image.draw(in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
}

// The command icon: a deep teal-to-indigo tile with a magnifier full of sparkles.
let icon = png(512) { rect in
    let tile = NSBezierPath(roundedRect: rect.insetBy(dx: 24, dy: 24), xRadius: 110, yRadius: 110)
    NSGradient(colors: [NSColor(calibratedRed: 0.09, green: 0.55, blue: 0.56, alpha: 1),
                        NSColor(calibratedRed: 0.24, green: 0.23, blue: 0.67, alpha: 1)])!
        .draw(in: tile, angle: -60)
    drawCentered(symbol("sparkle.magnifyingglass", pointSize: 250, color: .white), in: rect)
}
try icon.write(to: assets.appendingPathComponent("icon.png"))
print("icon in \(assets.path)")
