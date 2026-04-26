import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TourPrompt } from "./TourPrompt";
import { WAYMARK_TOUR } from "../../lib/tour/tours";

const SESSION_KEY = "wm_tour_seen";

const isDemo = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_DEMO_MODE === "true";

type Ctx = {
  openPrompt: () => void;
  enabled: boolean;
};

const TourCtx = createContext<Ctx>({ openPrompt: () => {}, enabled: false });

export function useTour() {
  return useContext(TourCtx);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    if (!isDemo) return;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_KEY) === "1") return;
    setPromptOpen(true);
  }, []);

  const openPrompt = useCallback(() => {
    setPromptOpen(true);
  }, []);

  const handleSkip = useCallback(() => {
    setPromptOpen(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    }
  }, []);

  const handleTake = useCallback(async () => {
    setPromptOpen(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    }
    const { runTour } = await import("../../lib/tour/run-tour");
    await runTour(WAYMARK_TOUR, async (route) => {
      navigate(route);
      await new Promise((r) => setTimeout(r, 350));
    });
  }, [navigate]);

  return (
    <TourCtx.Provider value={{ openPrompt, enabled: isDemo }}>
      {children}
      {promptOpen && <TourPrompt onTake={handleTake} onSkip={handleSkip} />}
    </TourCtx.Provider>
  );
}
