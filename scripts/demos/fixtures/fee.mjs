// Deliberately incorrect rounding for the recorded repair demonstration.
export function estimateFee(vbytes, rate) {
  return Math.floor(vbytes * rate);
}
