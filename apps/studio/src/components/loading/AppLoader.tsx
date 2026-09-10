import { useEffect, useState } from "react";
import { Logo } from "../brand/Logo";

const SLOW_LOAD_DELAY_MS = 7000;

export function AppLoader() {
  const [isTakingLonger, setIsTakingLonger] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setIsTakingLonger(true), SLOW_LOAD_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <main className="app-loader" aria-busy="true" aria-label="Preparing your Renvia workspace">
      <div className="app-loader-content" role="status" aria-live="polite">
        <div className="app-loader-brand" aria-hidden="true">
          <Logo wordmarkClassName="app-loader-wordmark" />
          <svg className="app-loader-mark" viewBox="0 0 54 54">
            <path d="M12 14H42" />
            <path d="M12 27H37" />
            <path d="M12 40H42" />
          </svg>
        </div>
        <p>Preparing your workspace<span className="app-loader-dots" aria-hidden="true" /></p>
        <p className={`app-loader-delay ${isTakingLonger ? "is-visible" : ""}`}>
          {isTakingLonger ? "This is taking longer than expected." : ""}
        </p>
      </div>
    </main>
  );
}
