// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axxlabs Limited
//
// A check card's taps (SPEC §3.4 "When a site still checks", §5.3): the person taps the page's screenshot where
// they'd click; the points go to the computer in the screenshot's own pixels as "x,y;x,y", at most 20.

export const MAX_TAPS = 20;

export interface Tap {
  x: number;
  y: number;
}

/** Where a tap at (clientX, clientY) lands on the image, in its own pixels; null if outside it. */
export function tapOnImage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  natural: { width: number; height: number },
): Tap | null {
  if (!rect.width || !rect.height || !natural.width || !natural.height) return null;
  const x = Math.floor(((clientX - rect.left) * natural.width) / rect.width);
  const y = Math.floor(((clientY - rect.top) * natural.height) / rect.height);
  if (x < 0 || y < 0 || x >= natural.width || y >= natural.height) return null;
  return { x, y };
}

/** The value of a `taps` field: "x,y;x,y", or "" for none ("It's done"). */
export function tapsValue(taps: Tap[]): string {
  return taps.slice(0, MAX_TAPS).map((t) => `${t.x},${t.y}`).join(";");
}

/** The check card's primary button: what tapping it will do. */
export function checkButton(taps: Tap[]): string {
  return taps.length ? `Send ${taps.length} tap${taps.length > 1 ? "s" : ""}` : "It's done";
}
