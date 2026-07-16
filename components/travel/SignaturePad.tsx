"use client";

import { useRef, useState } from "react";
import Button from "@/components/Button";
import Dropzone from "@/components/Dropzone";
import type { Signature } from "@/lib/travel/types";

export default function SignaturePad({
  value,
  onChange,
}: {
  value: Signature | null;
  onChange: (s: Signature | null) => void;
}) {
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawingRef.current = true;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange({ kind: "drawn", dataUrl: canvas.toDataURL("image/png") });
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  }

  function handleFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange({ kind: "uploaded", dataUrl: String(reader.result), fileName: file.name });
    reader.readAsDataURL(file);
  }

  return (
    <div data-testid="travel-signature-pad">
      <div className="mb-2 flex gap-1" data-testid="travel-signature-modes">
        {(["draw", "upload"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${mode === m ? "bg-primary text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            data-testid={`travel-signature-mode-${m}`}
          >
            {m === "draw" ? "Draw signature" : "Upload image"}
          </button>
        ))}
      </div>

      {mode === "draw" ? (
        <div>
          <canvas
            ref={canvasRef}
            width={420}
            height={140}
            className="cursor-crosshair rounded border border-gray-300 bg-white"
            data-testid="travel-signature-canvas"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={end}
          />
          <div className="mt-2">
            <Button type="button" variant="secondary" size="sm" onClick={clear} data-testid="travel-signature-clear">
              Clear
            </Button>
          </div>
        </div>
      ) : (
        <Dropzone onFiles={handleFiles} accept="image/*" testid="travel-signature-upload">
          {value?.kind === "uploaded" ? (
            <span className="text-sm text-navy-900">
              {value.fileName} <span className="text-xs text-gray-400">— drop another image to replace</span>
            </span>
          ) : (
            <span className="text-sm text-gray-600">
              Drop a signature image here <span className="text-xs text-gray-400">or click to browse</span>
            </span>
          )}
        </Dropzone>
      )}

      {value && mode === "upload" && (
        <div className="mt-2">
          <p className="mb-0.5 text-[11px] text-gray-500">Preview</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.dataUrl} alt="Signature preview" className="h-16 rounded border border-gray-200 bg-white" />
        </div>
      )}
    </div>
  );
}
