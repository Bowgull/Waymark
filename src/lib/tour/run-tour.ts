import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { TourStep } from "./tours";

type Navigator = (route: string) => Promise<void> | void;

const ELEMENT_TIMEOUT_MS = 4000;
const POLL_INTERVAL_MS = 80;

function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const start = Date.now();
    const interval = window.setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        window.clearInterval(interval);
        resolve(el);
      } else if (Date.now() - start > timeoutMs) {
        window.clearInterval(interval);
        resolve(null);
      }
    }, POLL_INTERVAL_MS);
  });
}

export async function runTour(steps: TourStep[], navigate: Navigator): Promise<void> {
  let cancelled = false;
  let activeDriver: Driver | null = null;

  for (let i = 0; i < steps.length; i++) {
    if (cancelled) break;
    const step = steps[i];

    if (step.route && window.location.pathname !== step.route) {
      await navigate(step.route);
    }

    const el = await waitForElement(step.selector, ELEMENT_TIMEOUT_MS);
    if (!el) {
      console.warn(`[tour] step "${step.title}" target ${step.selector} not found, skipping`);
      continue;
    }

    if (activeDriver) {
      (activeDriver as Driver).destroy();
      activeDriver = null;
    }

    const isLast = i === steps.length - 1;
    const stepCounter = `${i + 1} / ${steps.length}`;

    await new Promise<void>((resolve) => {
      const d = driver({
        showProgress: false,
        allowClose: true,
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.7,
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: "wm-tour-popover",
        steps: [
          {
            element: step.selector,
            popover: {
              title: `<span class="wm-tour-counter">${stepCounter}</span> ${step.title}`,
              description: step.body,
              side: step.side ?? "bottom",
              align: step.align ?? "start",
              showButtons: ["next", "close"],
              nextBtnText: isLast ? "Done" : "Next",
              onNextClick: () => {
                d.destroy();
                resolve();
              },
              onCloseClick: () => {
                cancelled = true;
                d.destroy();
                resolve();
              },
            },
          },
        ],
      });
      activeDriver = d;
      d.drive();
    });
  }

  if (activeDriver) {
    (activeDriver as Driver).destroy();
  }
}
