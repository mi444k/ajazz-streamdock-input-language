import Foundation
import AppKit

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent()
let images = root.appendingPathComponent("images")
try FileManager.default.createDirectory(at: images, withIntermediateDirectories: true)
func image(_ size: Int, _ name: String, draw: (NSRect) -> Void) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    draw(NSRect(x: 0, y: 0, width: size, height: size))
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: images.appendingPathComponent(name))
}
func keyboard(_ bounds: NSRect) {
    let transform = NSAffineTransform()
    transform.scale(by: bounds.width / 128)
    transform.concat()
    NSColor.white.setStroke(); NSColor.white.setFill()
    let outline = NSBezierPath(roundedRect: NSRect(x: 13, y: 29, width: 102, height: 70), xRadius: 8, yRadius: 8)
    outline.lineWidth = 6; outline.stroke()
    for column in 0..<4 { for row in 0..<2 {
        NSBezierPath(roundedRect: NSRect(x: 27 + column * 20, y: 60 + row * 18, width: 12, height: 10), xRadius: 2, yRadius: 2).fill()
    } }
    NSBezierPath(roundedRect: NSRect(x: 37, y: 42, width: 54, height: 7), xRadius: 2, yRadius: 2).fill()
}
try image(128, "icon.png", draw: keyboard)
try image(40, "action.png", draw: keyboard)
try image(48, "category.png", draw: keyboard)
try image(64, "idle.png") { bounds in
    NSGradient(starting: NSColor(srgbRed: 16/255, green: 37/255, blue: 58/255, alpha: 1), ending: NSColor(srgbRed: 36/255, green: 75/255, blue: 105/255, alpha: 1))!.draw(in: bounds, angle: 315)
    let font = NSFont(name: "AvenirNext-Bold", size: 30)!
    let text = "--" as NSString
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]
    let size = text.size(withAttributes: attributes)
    text.draw(at: NSPoint(x: (64-size.width)/2, y: (64-size.height)/2), withAttributes: attributes)
}
