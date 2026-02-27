export function KpiCard({ label, value, helpText }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="large"
      background="surface"
    >
      <s-text size="small" tone="subdued">
        {label}
      </s-text>
      <s-heading level="3">{value}</s-heading>
      {helpText ? (
        <s-text size="small" tone="subdued">
          {helpText}
        </s-text>
      ) : null}
    </s-box>
  );
}

