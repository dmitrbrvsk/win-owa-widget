// Fluent-style line icons, 24px grid.
const P: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  // A cog with teeth: the former circle-with-rays read as a sun, i.e. a theme switch.
  gear: '<path d="M22.0 10.2 L22.0 13.8 L19.5 13.3 L18.2 16.4 L20.4 17.9 L17.9 20.4 L16.4 18.2 L13.3 19.5 L13.8 22.0 L10.2 22.0 L10.7 19.5 L7.6 18.2 L6.1 20.4 L3.6 17.9 L5.8 16.4 L4.5 13.3 L2.0 13.8 L2.0 10.2 L4.5 10.7 L5.8 7.6 L3.6 6.1 L6.1 3.6 L7.6 5.8 L10.7 4.5 L10.2 2.0 L13.8 2.0 L13.3 4.5 L16.4 5.8 L17.9 3.6 L20.4 6.1 L18.2 7.6 L19.5 10.7Z"/><circle cx="12" cy="12" r="3.2"/>',
  warning: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevU: '<path d="m6 15 6-6 6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.8a10 10 0 0 1 4.6-2.5M19 12.8a10 10 0 0 0-2.4-1.8M2 8.8a15 15 0 0 1 4.4-2.7M22 8.8a15 15 0 0 0-10-3.7M12 20h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
};

const FILLED: Record<string, string> = {
  video: '<rect x="2" y="6" width="13" height="12" rx="3"/><path d="m16.5 10.2 5.5-3.2v10l-5.5-3.2Z"/>',
  joinCircle: '<circle cx="12" cy="12" r="10.5"/><path d="M7 12h9.5M12.5 7.5 17 12l-4.5 4.5" fill="none" stroke="var(--jc,#fff)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  dot: '<circle cx="12" cy="12" r="5"/>',
};

export function Icon({ name, size = 16, color, weight = 1.8 }: { name: string; size?: number; color?: string; weight?: number }) {
  const filled = FILLED[name];
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? (color ?? 'currentColor') : 'none'}
      stroke={filled ? undefined : (color ?? 'currentColor')}
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: filled ?? P[name] ?? '' }}
    />
  );
}
