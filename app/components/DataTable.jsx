import PropTypes from "prop-types";

export function DataTable({ columns, rows, emptyState }) {
  if (!rows?.length) {
    return emptyState ?? null;
  }

  return (
    <s-box borderWidth="base" borderRadius="large" background="surface">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                style={{
                  textAlign: column.align ?? "left",
                  padding: "8px 12px",
                  fontWeight: 500,
                }}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  style={{
                    textAlign: column.align ?? "left",
                    padding: "8px 12px",
                    borderTop: "1px solid var(--p-color-border-subdued, #e1e3e5)",
                  }}
                >
                  {row[column.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </s-box>
  );
}

DataTable.propTypes = {
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      header: PropTypes.node.isRequired,
      align: PropTypes.oneOf(["left", "right", "center"]),
    }),
  ).isRequired,
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    }),
  ).isRequired,
  emptyState: PropTypes.node,
};

