export type ScanItem = {
  typeName: string;
  scanData: string;
  points?: { x: number; y: number }[];
};

export type ScanState = {
  isScanning: boolean;
  facingMode: "user" | "environment";
  isTorchOn: boolean;
  scannedItems: ScanItem[];
};
