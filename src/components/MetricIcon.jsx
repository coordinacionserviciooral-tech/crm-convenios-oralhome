const paths = {
  convenios: (
    <>
      <path d="M8 4h8l4 4v12H4V4h4Z" />
      <path d="M15 4v5h5M8 13h8M8 17h5" />
    </>
  ),
  organizaciones: (
    <>
      <path d="M4 21V7l8-4v18M12 9h8v12M2 21h20M7 8v2m0 3v2m0 3v2m9-7h1m-1 4h1" />
    </>
  ),
  pendientes: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  vencidos: (
    <>
      <path d="m12 3 10 18H2L12 3Z" />
      <path d="M12 9v5m0 3h.01" />
    </>
  ),
};
export default function MetricIcon({ type }) {
  return (
    <span className={`metric-icon metric-${type}`} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[type]}
      </svg>
    </span>
  );
}
