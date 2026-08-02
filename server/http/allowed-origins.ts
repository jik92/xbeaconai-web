const defaultLocalOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];

export function resolveAllowedOrigins(input: {
  isProduction: boolean;
  apiPort: number;
  devWebPort?: string;
  configured?: string;
}) {
  const configuredOrigins = (input.configured ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const parsedDevWebPort = Number(input.devWebPort);
  const devWebOrigins =
    !input.isProduction && Number.isInteger(parsedDevWebPort) && parsedDevWebPort >= 1 && parsedDevWebPort <= 65535
      ? [`http://127.0.0.1:${parsedDevWebPort}`, `http://localhost:${parsedDevWebPort}`]
      : [];

  return new Set([
    ...defaultLocalOrigins,
    `http://127.0.0.1:${input.apiPort}`,
    `http://localhost:${input.apiPort}`,
    ...devWebOrigins,
    ...configuredOrigins,
  ]);
}
