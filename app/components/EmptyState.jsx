export function EmptyState({ heading, description, action }) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="large"
      background="subdued"
    >
      <s-stack direction="block" gap="base">
        <s-heading level="3">{heading}</s-heading>
        {description ? (
          <s-text tone="subdued" as="p">
            {description}
          </s-text>
        ) : null}
        {action ? <div>{action}</div> : null}
      </s-stack>
    </s-box>
  );
}

