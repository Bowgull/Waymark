export type TourStep = {
  route?: string;
  selector: string;
  title: string;
  body: string;
  side?: "top" | "right" | "bottom" | "left" | "over";
  align?: "start" | "center" | "end";
};

export const WAYMARK_TOUR: TourStep[] = [
  {
    route: "/today",
    selector: "[data-tour='wellness-card']",
    title: "Today",
    body: "Wellness check-in at the top. Sleep, soreness, alcohol, weed, notes. The coach reads what you log and adjusts what's coming. Sessions below, grouped by AM and PM.",
  },
  {
    route: "/today",
    selector: "[data-tour='session-row']",
    title: "Session row",
    body: "Tap to expand. Strava badges show on auto-matched sessions. Zone 2 sessions show the HR band you're meant to hold.",
  },
  {
    route: "/today",
    selector: "[data-tour='session-row']",
    title: "Skip a session",
    body: "Tap a planned session and you get Skip and Replace. Skip gives you seven reasons. Sore, tired, injury, time, sick, low motivation, other. Injury opens body part picker. The coach reads the reason overnight and replans the rest of the week. No push. No toast. You see the new plan the next time you open Today.",
  },
  {
    route: "/today",
    selector: "[data-tour='session-row']",
    title: "Replace",
    body: "Replace gives you six reasons. Claude generates three to five alternatives based on why you're swapping. Pick one, the session swaps in, the rest of the week recalculates around it.",
  },
  {
    route: "/library",
    selector: "[data-tour='exercise-card']",
    title: "Inside a session",
    body: "Tap any exercise to see form cues and a video link. In an actual session, this same exercise gets plate math (type a weight, see what to grab per side), a rest timer between sets (ring is the timer, center counts down), and live wave percentages off your training max. The session screen is built around getting you in and out without doing math.",
  },
  {
    route: "/program",
    selector: "[data-tour='program-page']",
    title: "Block Zero",
    body: "Six week ramp before real load starts. Skipping straight to heavy weights tears tendons. Block Zero estimates your starting weights at 40 to 55 percent of perceived maxes, then waves up. Skippable if you're already trained. Most people shouldn't.",
  },
  {
    route: "/today",
    selector: "[data-tour='session-row']",
    title: "Outdoor or Indoor",
    body: "On a run session: Outdoor pulls in Strava. Pace, HR, splits, the whole record. Indoor pulls up One Pace. The fan edit of One Piece that cuts the filler. A thousand episodes becomes five hundred. The treadmill is a tax. This is the rebate.",
  },
  {
    route: "/library",
    selector: "[data-tour='waybook']",
    title: "Library, Waybook, Ledger insights",
    body: "Library is every exercise in the program. Form videos, cues, muscle groups, practice counts. Waybook is your training journal. Reflections during sessions, notes after. Face ID gated because it's yours, not the program's. Ledger insights run on Haiku, debounced. Two to four observations per visit. Cinzel serif, gold tilde, no congratulations.",
  },
  {
    route: "/settings",
    selector: "[data-tour='alarm-section']",
    title: "Settings",
    body: "MT days, AM alarm, PM leave-by, One Pace arc and episode, enabled techniques, Strava connection, Waybook gate. The morning alarm escalates if you don't get up. \"IT'S {time}. YOU SAID YOU WANTED THIS.\" \"STILL IN BED. BULLSHIT.\" \"GET THE FUCK UP.\" \"YOU KNOW WHAT YOU ARE RIGHT NOW? SOFT.\" Capacitor pushes them as native iOS notifications. Silent mode goes haptic only. That's the tour.",
  },
];
