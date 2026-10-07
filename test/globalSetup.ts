// The tests that build local dates (the free-time grid, the confirmation text) were written for a fixed
// zone. Setting it here, before any worker starts, makes `npm test` give the same result on every
// machine, not only where the TZ environment variable happens to be set (as CI does).
export default function setup() {
  process.env.TZ = 'Europe/Moscow';
}
