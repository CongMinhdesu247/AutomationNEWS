export function isSampleUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.hostname === "fixture.invalid" ||
      url.hostname.endsWith(".fixture.invalid") ||
      url.href === "https://93.184.216.34/feed"
    );
  } catch {
    return false;
  }
}
