export type ControlIconName =
  | "sun"
  | "moon"
  | "power"
  | "sound-on"
  | "sound-off"
  | "engine-sound"
  | "engine-muted"
  | "chase"
  | "helm"
  | "orbit"
  | "drone"
  | "reset"
  | "photo"
  | "map"
  | "bell"
  | "flare"
  | "target"
  | "shutter"
  | "tilt"
  | "close";

export function ControlIcon({ name }: { name: ControlIconName }) {
  return (
    <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "reset" && <path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" />}
      {(name === "photo" || name === "shutter") && (
        <>
          <path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
          <circle cx="12" cy="13" r="4" />
          {name === "shutter" && <circle cx="12" cy="13" r="1.4" />}
        </>
      )}
      {name === "map" && (
        <>
          <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z" />
          <path d="M9 4v13.5M15 6.5V20" />
        </>
      )}
      {name === "bell" && (
        <>
          <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 1.8H4.4Z" />
          <path d="M10 20.5a2 2 0 0 0 4 0M12 3v2" />
        </>
      )}
      {name === "flare" && (
        <>
          <path d="M5 19.5 15.5 9" />
          <path d="M14 5.5 18.5 10M17.5 3.2l.6 2.3 2.3.6-2.3.6-.6 2.3-.6-2.3-2.3-.6 2.3-.6Z" />
          <path d="M4 16.5l3.5 3.5" />
        </>
      )}
      {name === "target" && (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2.3" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </>
      )}
      {name === "tilt" && (
        <>
          <rect x="7.5" y="3.5" width="9" height="17" rx="2" transform="rotate(-18 12 12)" />
          <path d="M3 9.5a9 9 0 0 1 2.4-4.2M21 14.5a9 9 0 0 1-2.4 4.2" />
        </>
      )}
      {name === "close" && <path d="M6 6l12 12M18 6 6 18" />}
      {name === "sun" && (
        <>
          <circle cx="12" cy="12" r="3.4" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
        </>
      )}
      {name === "moon" && <path d="M20.2 15.1A8.2 8.2 0 0 1 8.9 3.8 8.3 8.3 0 1 0 20.2 15.1Z" />}
      {name === "power" && (
        <>
          <path d="M12 2.8v8.1" />
          <path d="M7.2 5.8a8 8 0 1 0 9.6 0" />
        </>
      )}
      {(name === "sound-on" || name === "sound-off") && (
        <>
          <path d="M4 10h3.1l4.2-3.6v11.2L7.1 14H4Z" />
          {name === "sound-on" ? (
            <path d="M15 9a4.4 4.4 0 0 1 0 6M17.8 6.5a7.8 7.8 0 0 1 0 11" />
          ) : (
            <path d="m15.3 10 4 4M19.3 10l-4 4" />
          )}
        </>
      )}
      {(name === "engine-sound" || name === "engine-muted") && (
        <>
          <path d="M3 10h2.2l1.7-2.4h6.9l1.7 2.4H18v7H6.2l-1.4-2H3Z" />
          <path d="M8.2 7.6V5.2h4.3M18 11.2h2M20 9.5v5" />
          {name === "engine-sound" ? <path d="M8.5 12.2h3.4M8.5 14.8h5.4" /> : <path d="M5 5l14 14" />}
        </>
      )}
      {name === "chase" && (
        <>
          <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          <path d="m8 14 4-6 4 6-4 2Z" />
        </>
      )}
      {name === "helm" && (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 4.5v5.5M12 14v5.5M4.5 12H10M14 12h5.5M6.7 6.7l3.9 3.9M13.4 13.4l3.9 3.9M17.3 6.7l-3.9 3.9M10.6 13.4l-3.9 3.9" />
        </>
      )}
      {name === "orbit" && (
        <>
          <circle cx="12" cy="12" r="2.4" />
          <path d="M4.3 10A8 8 0 0 1 18 6.5l1.5 1.2M19.7 14A8 8 0 0 1 6 17.5l-1.5-1.2" />
          <path d="m19.7 4.5-.2 3.2-3.2-.2M4.3 19.5l.2-3.2 3.2.2" />
        </>
      )}
      {name === "drone" && (
        <>
          <rect x="9" y="9" width="6" height="6" rx="1.5" />
          <path d="M9.4 9.4 6.5 6.5M14.6 9.4l2.9-2.9M9.4 14.6l-2.9 2.9M14.6 14.6l2.9 2.9" />
          <circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
        </>
      )}
    </svg>
  );
}
