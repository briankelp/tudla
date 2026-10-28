export function BusinessAvatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const tone =
    [...name].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  return (
    <span className={`company-avatar avatar-tone-${tone}`} aria-hidden="true">
      {initials || "—"}
    </span>
  );
}
