import type { scanImageData } from "@undecaf/zbar-wasm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearItemsFromStorage,
  convertToGrayscale,
  getMediaConstraints,
  isTouchDevice,
  loadItemsFromStorage,
  playScanBeep,
  saveItemsToStorage,
  stopAllTracks,
} from "../utils/helpers";
import type { ScanItem, ScanState } from "./types";

const useNacs = () => {
  const SCAN_INTERVAL = 150;

  const [scanState, setScanState] = useState<ScanState>({
    isScanning: false,
    facingMode: "environment",
    isTorchOn: false,
    scannedItems: loadItemsFromStorage(),
  });

  const [hasScannedNew, setHasScannedNew] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanImageDataRef = useRef<typeof scanImageData | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const lastScanTime = useRef<number>(0);
  const isScanningRef = useRef<boolean>(false);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const usingOffscreenCanvas = useRef<boolean>(false);

  useEffect(() => {
    isScanningRef.current = scanState.isScanning;
  }, [scanState.isScanning]);

  useEffect(() => {
    saveItemsToStorage(scanState.scannedItems);
    if (!scanState.scannedItems.length) {
      setHasScannedNew(false);
    }
  }, [scanState.scannedItems]);

  const updateItems = (item: ScanItem) => {
    setScanState((p) => {
      if (p.scannedItems.some((d) => d.scanData === item.scanData)) return p;
      const newItems = [...p.scannedItems, item];
      playScanBeep(newItems.length);
      navigator.vibrate?.(300);
      setHasScannedNew(true);
      return { ...p, scannedItems: newItems };
    });
  };

  useEffect(() => {
    try {
      const off = new OffscreenCanvas(1, 1);
      const ctx = off.getContext("2d");
      usingOffscreenCanvas.current = !!ctx;
      if (import.meta.env.DEV) {
        console.log(
          usingOffscreenCanvas.current
            ? "OffscreenCanvas with 2d context is supported."
            : "OffscreenCanvas 2d context NOT supported.",
        );
      }
    } catch {
      usingOffscreenCanvas.current = false;
      if (import.meta.env.DEV) {
        console.log("OffscreenCanvas is NOT supported.");
      }
    }
  }, []);

  const startScan = async () => {
    setScanState((p) => ({ ...p, isScanning: true }));
    try {
      if (!scanImageDataRef.current) {
        const zbar = await import("@undecaf/zbar-wasm");
        scanImageDataRef.current = zbar.scanImageData;
      }
      const constraints = await getMediaConstraints(scanState.facingMode);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;

      videoRef.current.onplay = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d", {
          /** https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getContextAttributes#willreadfrequently */
          willReadFrequently: true,
        });
        const video = videoRef.current;
        if (!canvas || !ctx || !video) return;

        const w = video.videoWidth;
        const h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;

        if (usingOffscreenCanvas.current) {
          if (
            !offscreenCanvasRef.current ||
            offscreenCanvasRef.current.width !== w ||
            offscreenCanvasRef.current.height !== h
          ) {
            offscreenCanvasRef.current = new OffscreenCanvas(w, h);
          }
        }

        const tick = async () => {
          if (!isScanningRef.current) return stopScan();

          const now = Date.now();
          if (now - lastScanTime.current < SCAN_INTERVAL) {
            animationFrameId.current = requestAnimationFrame(tick);
            return;
          }
          lastScanTime.current = now;

          let imageData: ImageData;
          if (usingOffscreenCanvas.current && offscreenCanvasRef.current) {
            const offCtx = offscreenCanvasRef.current.getContext("2d", {
              /** https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getContextAttributes#willreadfrequently */
              willReadFrequently: true,
            });
            if (!offCtx) return;
            offCtx.drawImage(video, 0, 0, w, h);
            imageData = offCtx.getImageData(0, 0, w, h);
          } else {
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempCtx = tempCanvas.getContext("2d", {
              /** https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getContextAttributes#willreadfrequently */
              willReadFrequently: true,
            });

            if (!tempCtx) return;
            tempCtx.drawImage(video, 0, 0, w, h);
            imageData = tempCtx.getImageData(0, 0, w, h);
          }

          const gray = convertToGrayscale(imageData);
          const res = await scanImageDataRef.current?.(gray);

          ctx.clearRect(0, 0, w, h);

          if (res?.length) {
            for (const symbol of res) {
              const points = symbol.points;
              const decoded = symbol.decode();
              if (points?.length) {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                points.forEach((p) => ctx.lineTo(p.x, p.y));
                ctx.closePath();

                ctx.lineWidth = Math.max(Math.min(w, h) / 100, 2);
                ctx.strokeStyle = "#00e000";
                ctx.stroke();

                ctx.font = "16px monospace";
                const labelWidth = ctx.measureText(decoded).width + 10;
                const labelHeight = 22;
                ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
                ctx.fillRect(points[0].x, points[0].y - labelHeight, labelWidth, labelHeight);

                ctx.fillStyle = "#ffffff";
                ctx.fillText(decoded, points[0].x + 5, points[0].y - 6);

                updateItems({
                  typeName: symbol.typeName.replace("ZBAR_", ""),
                  scanData: decoded,
                  points: symbol.points,
                });
              }
            }
          }

          animationFrameId.current = requestAnimationFrame(tick);
        };
        animationFrameId.current = requestAnimationFrame(tick);
      };
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error(err);
      }
      setScanState((p) => ({ ...p, isScanning: false }));
    }
  };

  const stopScan = useCallback(() => {
    setScanState((p) => ({ ...p, isScanning: false }));
    animationFrameId.current && cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = null;

    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stopAllTracks(stream);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const switchCamera = async () => {
    if (!videoRef.current) return;
    const newMode = scanState.facingMode === "user" ? "environment" : "user";
    try {
      stopAllTracks(videoRef.current.srcObject as MediaStream);
      const stream = await navigator.mediaDevices.getUserMedia(await getMediaConstraints(newMode));
      videoRef.current.srcObject = stream;
      setScanState((p) => ({ ...p, facingMode: newMode }));
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error(err);
      }
    }
  };

  const toggleTorch = async () => {
    const track =
      videoRef.current?.srcObject instanceof MediaStream
        ? videoRef.current.srcObject.getVideoTracks()[0]
        : null;

    if (!track) return;

    const caps = track.getCapabilities?.();
    if (!caps || !("torch" in caps)) return;

    try {
      await track.applyConstraints({
        advanced: [{ torch: !scanState.isTorchOn } as MediaTrackConstraintSet],
      });
      setScanState((p) => ({ ...p, isTorchOn: !p.isTorchOn }));
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error(err);
      }
    }
  };

  const clearItems = () => {
    if (!window.confirm("Clear all scanned items?")) return;

    stopScan();
    setScanState((p) => ({ ...p, scannedItems: [] }));
    clearItemsFromStorage();
    setHasScannedNew(false);
    startScan();
  };

  const deleteItem = (index: number) => {
    setScanState((p) => {
      const items = [...p.scannedItems];
      items.splice(index, 1);
      return { ...p, scannedItems: items };
    });
  };

  const copyAll = () => {
    const items = scanState.scannedItems;
    if (!items.length) return alert("Nothing to copy.");

    const text = `Total: ${items.length} item(s)\n\n${items.map((d) => d.scanData).join("\n")}`;
    navigator.clipboard.writeText(text).then(
      () => alert("Copied to clipboard."),
      () => alert("Copy failed."),
    );
  };

  const shareWA = () => {
    const items = scanState.scannedItems;
    if (!items.length) return alert("Nothing to share.");

    const text = `Total: ${items.length} item(s)\n\n${items.map((d) => d.scanData).join("\n")}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`);
  };

  useEffect(() => stopScan, [stopScan]);

  return {
    scanState,
    hasScannedNew,
    videoRef,
    canvasRef,
    startScan,
    stopScan,
    switchCamera,
    toggleTorch,
    clearItems,
    deleteItem,
    copyAll,
    shareWA,
  };
};

const Nacs = () => {
  const {
    scanState: { isScanning, facingMode, isTorchOn, scannedItems },
    hasScannedNew,
    videoRef,
    canvasRef,
    startScan,
    stopScan,
    switchCamera,
    toggleTorch,
    clearItems,
    deleteItem,
    copyAll,
    shareWA,
  } = useNacs();

  const showSwitch = isTouchDevice();
  const showTorch = isTouchDevice() && facingMode === "environment";

  const renderInfoMessage = () => (
    <div className="text-base border border-dashed border-black p-4 text-gray-700 text-center mb-2">
      {scannedItems.length === 0 ? (
        <>
          Press <strong>Start</strong> to begin scanning.
        </>
      ) : (
        <>
          Loaded <strong>{scannedItems.length}</strong> item{scannedItems.length !== 1 ? "s" : ""}.
          Press <strong>Start</strong> to scan more.
        </>
      )}
    </div>
  );

  const renderItemList = () => (
    <>
      <ul className="text-base space-y-2 overflow-y-auto pr-1 flex-1 border border-black p-2">
        {[...scannedItems].reverse().map((item, i) => {
          const realIndex = scannedItems.length - 1 - i;
          return (
            <li key={`${item.scanData}-${i}`} className="flex justify-between items-center">
              <span>
                {realIndex + 1}. ({item.typeName.toLowerCase()}) {item.scanData}
              </span>
              <button
                type="button"
                onClick={() => deleteItem(realIndex)}
                className="ml-2 px-2 py-0.5 border border-black bg-white text-black text-xs"
              >
                del
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={copyAll}
          className="px-3 py-1 border border-black bg-white text-black"
        >
          Copy all
        </button>
        <button
          type="button"
          onClick={shareWA}
          className="px-3 py-1 border border-green-600 text-green-600 bg-white"
        >
          Share to WA
        </button>
        <button
          type="button"
          onClick={clearItems}
          className="px-3 py-1 border border-red-600 text-red-600 bg-white"
        >
          Clear
        </button>
      </div>
    </>
  );

  return (
    <div className="h-[100svh] flex flex-col bg-white text-black font-mono">
      {/* Title */}
      <div className="h-[5%] flex items-center justify-center border-b border-black">
        <h1 className="text-xl font-bold">
          nacs <small>v0</small>
        </h1>
      </div>

      {/* Video with overlay */}
      <div
        className="relative border-b border-black"
        style={{
          width: "100%",
          paddingTop: `${((videoRef.current?.videoHeight || 9) / (videoRef.current?.videoWidth || 16)) * 100}%`,
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          controls={false}
          className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none select-none"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
      </div>

      {/* Buttons */}
      <div className="h-[10%] flex justify-between items-center border-b border-black px-2">
        {showSwitch ? (
          <button
            type="button"
            onClick={switchCamera}
            className="px-3 py-1 border border-black bg-white text-black"
          >
            Switch
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          onClick={isScanning ? stopScan : startScan}
          className={`px-3 py-1 border bg-white ${
            isScanning ? "border-red-600 text-red-600" : "border-blue-600 text-blue-600"
          }`}
        >
          {isScanning ? "Stop" : "Start"}
        </button>

        {showTorch ? (
          <button
            type="button"
            onClick={toggleTorch}
            className="px-3 py-1 border border-black bg-white text-black"
          >
            {isTorchOn ? "Torch off" : "Torch on"}
          </button>
        ) : (
          <div />
        )}
      </div>

      {/* Scanned Items */}
      <div className="h-[30%] mt-2 px-4 pb-4 overflow-hidden flex flex-col">
        <h3 className="text-lg font-semibold mb-2">
          Scanned Item{scannedItems.length !== 1 ? "s" : ""}{" "}
          {scannedItems.length > 0 && `(${scannedItems.length})`}
        </h3>

        {!hasScannedNew && renderInfoMessage()}
        {scannedItems.length > 0 && renderItemList()}
      </div>
    </div>
  );
};

export default Nacs;
