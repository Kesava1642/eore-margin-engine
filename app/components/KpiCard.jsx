import PropTypes from "prop-types";

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

KpiCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  helpText: PropTypes.string,
};


