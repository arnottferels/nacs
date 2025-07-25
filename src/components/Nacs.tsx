import type { scanImageData as ScanImageDataFn } from "@undecaf/zbar-wasm";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  convertToGrayscale,
  getMediaConstraints,
  isTouchDevice,
  playScanBeep,
  stopAllTracks,
} from "../utils/helpers";

type ScanItem = {
  typeName: string;
  scanData: string;
};

type ScanState = {
  isScanning: boolean;
  facingMode: "user" | "environment";
  isTorchOn: boolean;
  scannedItems: ScanItem[];
};

const useNacs = () => {
  const getInitialScannedItems = (): ScanItem[] => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("x_scanned_items");
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  };

  const [scanState, setScanState] = useState<ScanState>({
    isScanning: false,
    facingMode: "environment",
    isTorchOn: false,
    scannedItems: getInitialScannedItems(),
  });

  // Track if user scanned new items after first load
  const [hasScannedNew, setHasScannedNew] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const scanImageDataRef = useRef<typeof ScanImageDataFn | null>(null);

  const SCAN_INTERVAL = 150;
  const lastScanTimeRef = useRef<number>(0);
  const isScanningRef = useRef<boolean>(scanState.isScanning);

  useEffect(() => {
    isScanningRef.current = scanState.isScanning;
  }, [scanState.isScanning]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("x_scanned_items", JSON.stringify(scanState.scannedItems));
    } catch (e) {
      console.error("Failed to save scanned items", e);
    }
  }, [scanState.scannedItems]);

  // Reset hasScannedNew if items cleared
  useEffect(() => {
    if (scanState.scannedItems.length === 0) {
      setHasScannedNew(false);
    }
  }, [scanState.scannedItems]);

  const handleError = (error: unknown) => {
    console.error(error);
    setScanState((p) => ({ ...p, isScanning: false }));
  };

  const handleScan = async () => {
    setScanState((p) => ({ ...p, isScanning: true }));

    try {
      if (!scanImageDataRef.current) {
        const zbar = await import("@undecaf/zbar-wasm");
        scanImageDataRef.current = zbar.scanImageData;
      }

      if (!scanImageDataRef.current) return;

      const scanImageData = scanImageDataRef.current;
      const mediaConstraints = await getMediaConstraints(scanState.facingMode);
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        videoRef.current.onplay = () => {
          const canvas = canvasRef.current;
          if (!canvas || !videoRef.current) return;

          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;

          const { videoWidth: w, videoHeight: h } = videoRef.current;
          canvas.width = w;
          canvas.height = h;

          const tick = async () => {
            if (!isScanningRef.current) {
              handleStopScan();
              return;
            }

            const now = Date.now();
            if (now - lastScanTimeRef.current < SCAN_INTERVAL) {
              animationFrameId.current = requestAnimationFrame(tick);
              return;
            }

            lastScanTimeRef.current = now;

            if (!videoRef.current) return;
            ctx.drawImage(videoRef.current, 0, 0, w, h);

            const imageData = ctx.getImageData(0, 0, w, h);
            const gray = convertToGrayscale(imageData);
            const res = await scanImageData(gray);

            if (res?.length) {
              const item: ScanItem = {
                typeName: res[0].typeName.replace("ZBAR_", ""),
                scanData: res[0].decode(),
              };

              setScanState((p) => {
                const dup = p.scannedItems.some((d) => d.scanData === item.scanData);
                if (dup) return p;

                const newItems = [...p.scannedItems, item];
                navigator.vibrate?.(300);
                playScanBeep(newItems.length);
                // Mark new item scanned
                setHasScannedNew(true);
                return { ...p, scannedItems: newItems };
              });
            }

            animationFrameId.current = requestAnimationFrame(tick);
          };

          animationFrameId.current = requestAnimationFrame(tick);
        };
      }
    } catch (err) {
      handleError(err);
    }
  };

  const handleStopScan = useCallback(() => {
    setScanState((p) => ({ ...p, isScanning: false }));

    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    if (videoRef.current?.srcObject instanceof MediaStream) {
      stopAllTracks(videoRef.current.srcObject);
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleSwitchCamera = async () => {
    if (!videoRef.current) return;

    if (videoRef.current.srcObject instanceof MediaStream) {
      stopAllTracks(videoRef.current.srcObject);
    }

    const newMode = scanState.facingMode === "user" ? "environment" : "user";

    try {
      const constraints = await getMediaConstraints(newMode);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoRef.current.srcObject = stream;
      setScanState((p) => ({ ...p, facingMode: newMode }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleTorch = async () => {
    const track =
      videoRef.current?.srcObject instanceof MediaStream
        ? videoRef.current.srcObject.getVideoTracks()[0]
        : null;

    if (!track) return;

    const caps = track.getCapabilities?.() as MediaTrackCapabilities;
    if (!("torch" in caps)) return;

    try {
      await track.applyConstraints({
        advanced: [{ torch: !scanState.isTorchOn } as unknown as MediaTrackConstraintSet],
      });

      setScanState((p) => ({ ...p, isTorchOn: !p.isTorchOn }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleDataCopy = () => {
    const all = scanState.scannedItems.map((d) => d.scanData).join("\n");
    navigator.clipboard.writeText(all);
  };

  const handleClear = () => {
    const ok = window.confirm("Are you sure you want to clear all scanned items?");
    if (!ok) return;

    setScanState((p) => ({ ...p, scannedItems: [] }));
    localStorage.removeItem("x_scanned_items");
    setHasScannedNew(false);
  };

  const handleDeleteItem = (index: number) => {
    setScanState((p) => {
      const newItems = [...p.scannedItems];
      newItems.splice(index, 1);
      return { ...p, scannedItems: newItems };
    });
  };

  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject instanceof MediaStream)
        stopAllTracks(videoRef.current.srcObject);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);

  const copyToClipboard = () => {
    const items = scanState.scannedItems;
    if (!items.length) {
      alert("Nothing to copy.");
      return;
    }

    const header = `Total: ${items.length} item(s)\n\n`;
    const text = items.map((d) => d.scanData).join("\n");
    navigator.clipboard
      .writeText(header + text)
      .then(() => {
        alert("Copied to clipboard.");
      })
      .catch(() => {
        alert("Copy failed.");
      });
  };

  const shareToWhatsApp = () => {
    const items = scanState.scannedItems;
    if (!items.length) {
      alert("Nothing to share.");
      return;
    }

    const header = `Total: ${items.length} item(s)\n\n`;
    const text = items.map((d) => d.scanData).join("\n");
    const message = header + text;

    const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(waUrl);
  };

  return {
    scanState,
    hasScannedNew,
    videoRef,
    canvasRef,
    handleScan,
    handleStopScan,
    handleSwitchCamera,
    handleToggleTorch,
    handleDataCopy,
    handleClear,
    handleDeleteItem,
    copyToClipboard,
    shareToWhatsApp,
  };
};

const Nacs = () => {
  const {
    scanState,
    hasScannedNew,
    videoRef,
    canvasRef,
    handleScan,
    handleStopScan,
    handleSwitchCamera,
    handleToggleTorch,
    handleClear,
    handleDeleteItem,
    copyToClipboard,
    shareToWhatsApp,
  } = useNacs();

  const { isScanning, facingMode, isTorchOn, scannedItems } = scanState;

  return (
    <div className="h-[100svh] flex flex-col bg-white text-black font-mono">
      {/* Title */}
      <div className="h-[5%] flex items-center justify-center border-b border-black">
        <h1 className="text-xl font-bold">
          nacs <small>v0</small>
        </h1>
      </div>

      {/* Video */}
      <div className="h-[50%] flex justify-center items-center border-b border-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          controls={false}
          className="w-full h-full object-cover pointer-events-none select-none"
        />
      </div>

      <canvas ref={canvasRef} hidden />

      {/* Buttons */}
      <div className="h-[10%] flex justify-between items-center border-b border-black px-2">
        <div>
          {isTouchDevice() && (
            <button
              type="button"
              onClick={handleSwitchCamera}
              className="px-3 py-1 border border-black bg-white text-black"
            >
              Switch
            </button>
          )}
        </div>

        <div>
          {isScanning ? (
            <button
              type="button"
              onClick={handleStopScan}
              className="px-3 py-1 border border-red-600 text-red-600 bg-white"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={handleScan}
              className="px-3 py-1 border border-blue-600 text-blue-600 bg-white"
            >
              Start
            </button>
          )}
        </div>

        <div>
          {isTouchDevice() && facingMode === "environment" && (
            <button
              type="button"
              onClick={handleToggleTorch}
              className="px-3 py-1 border border-black bg-white text-black"
            >
              {isTorchOn ? "Torch Off" : "Torch On"}
            </button>
          )}
        </div>
      </div>

      {/* Scanned Items */}
      <div className="h-[30%] mt-2 px-4 pb-4 overflow-hidden flex flex-col">
        <h3 className="text-lg font-semibold mb-2">
          Scanned Items {scannedItems.length > 0 && `(${scannedItems.length})`}
        </h3>

        {!hasScannedNew && (
          <div className="text-base border border-dashed border-black p-4 text-gray-700 text-center mb-2">
            {scannedItems.length === 0 ? (
              <>
                Press <strong>Start</strong> to begin scanning.
              </>
            ) : (
              <>
                Loaded <strong>{scannedItems.length}</strong> item(s). Press <strong>Start</strong>{" "}
                to scan more.
              </>
            )}
          </div>
        )}

        {scannedItems.length > 0 && (
          <>
            <ul className="text-base space-y-2 overflow-y-auto pr-1 flex-1 border border-black p-2">
              {[...scannedItems]
                .slice()
                .reverse()
                .map((d, i) => (
                  <li key={`${d.scanData}-${i}`} className="flex justify-between items-center">
                    <span>
                      {scannedItems.length - i}. ({d.typeName.toLowerCase()}) {d.scanData}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(scannedItems.length - 1 - i)}
                      className="ml-2 px-2 py-0.5 border border-black bg-white text-black text-xs"
                    >
                      Del
                    </button>
                  </li>
                ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={copyToClipboard}
                className="px-3 py-1 border border-black bg-white text-black"
              >
                Copy All
              </button>
              <button
                type="button"
                onClick={shareToWhatsApp}
                className="px-3 py-1 border border-green-600 text-green-600 bg-white"
              >
                Share to WA
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-1 border border-red-600 text-red-600 bg-white"
              >
                Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Nacs;
