import PropTypes from "prop-types";

const STATUS_TONE = {
  Pending: "warning",
  Implemented: "success",
  Reviewed: "subdued",
};

export function DecisionStatusPill({ status }) {
  const tone = STATUS_TONE[status] ?? "subdued";

  return (
    <s-badge tone={tone} size="small">
      {status}
    </s-badge>
  );
}

DecisionStatusPill.propTypes = {
  status: PropTypes.string.isRequired,
};


