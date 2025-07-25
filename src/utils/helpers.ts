export const isTouchDevice = () => {
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const noHover = window.matchMedia?.("(hover: none) and (pointer: coarse)").matches;

  return isMobile || noHover;
};

export const convertToGrayscale = (imageData: ImageData): ImageData => {
  const data = imageData.data;
  const len = data.length;

  let i = 0;
  while (i < len) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // weighted grayscale: 0.299R + 0.587G + 0.114B
    const gray = ((r * 299 + g * 587 + b * 114) / 1000) | 0;

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    // alpha remains unchanged (i + 3)

    i += 4;
  }

  return imageData;
};

export const getCameraIdWithFlash = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const device of devices) {
    const constraints = {
      video: {
        deviceId: device.deviceId,
        facingMode: "environment",
      },
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const videoTrack = stream.getVideoTracks()[0];

      type TorchCapableTrack = MediaTrackCapabilities & {
        torch?: boolean;
      };

      const capabilities = videoTrack.getCapabilities() as TorchCapableTrack;
      if (capabilities.torch) {
        stream.getTracks().forEach((track) => track.stop());
        return device.deviceId;
      }
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      // Ignore errors for unavailable devices
    }
  }
  return null;
};

export const getAndSetCameraIdWithFlash = async () => {
  let cameraId = localStorage.getItem("x_camera_id");
  if (!cameraId) {
    cameraId = await getCameraIdWithFlash();
    if (cameraId) {
      localStorage.setItem("x_camera_id", cameraId);
    }
  }
  return cameraId;
};

export const getMediaConstraints = async (facingMode) => {
  // const baseSettings = isTouchDevice()
  //   ? { height: { ideal: 1080 }, width: { ideal: 1920 } }
  //   : { height: { ideal: 720 }, width: { ideal: 1280 } };
  const customConstraints = {
    audio: false,
    video: {
      // ...baseSettings,
      aspectRatio: undefined,
      facingMode: facingMode,
      resizeMode: false,
      focusMode: "continuous",
      focusDistance: 0,
      exposureMode: "continuous",
      zoom: facingMode === "user" ? 1 : 1,
      frameRate: { ideal: 15, max: 30 },
    } as MediaTrackConstraints,
  };
  if (facingMode === "environment" && isTouchDevice()) {
    const cameraId = await getAndSetCameraIdWithFlash();
    if (cameraId) {
      customConstraints.video.deviceId = cameraId;
    }
  }
  return customConstraints;
};

export const stopAllTracks = (stream) => {
  if (stream) {
    const tracks = stream.getTracks();
    for (const track of tracks) {
      track.stop();
    }
  }
};

export const playScanBeep = (index) => {
  const notes = [
    261.63, // Do (C4)
    293.66, // Re (D4)
    329.63, // Mi (E4)
    349.23, // Fa (F4)
    392.0, // So (G4)
    440.0, // La (A4)
    493.88, // Ti (B4)
    523.25, // Do (C5)
  ].map((n) => n * 4); // transpose 2 octaves up

  const step = index % notes.length;
  const freq = notes[step];

  const AudioCtx =
    typeof window.AudioContext !== "undefined"
      ? window.AudioContext
      : (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  const ctx = new AudioCtx();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "square"; // Natural smooth tone
  osc.frequency.value = freq;

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.2);
  osc.onended = () => ctx.close();
};
