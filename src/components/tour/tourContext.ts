import { createContext, useContext } from "react";

type Ctx = {
  openPrompt: () => void;
  enabled: boolean;
};

export const TourCtx = createContext<Ctx>({ openPrompt: () => {}, enabled: false });

export function useTour() {
  return useContext(TourCtx);
}
