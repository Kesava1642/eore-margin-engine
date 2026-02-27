import { getStoreContext } from "./shopify.server";

const COST_NAMESPACE = "eore";
const COST_KEY = "unit_cost";

export const COST_METAFIELD_IDENTIFIER = {
  namespace: COST_NAMESPACE,
  key: COST_KEY,
};

export async function ensureCostMetafieldDefinition(request) {
  const { admin } = await getStoreContext(request);

  const response = await admin.graphql(
    `#graphql
      query eoreCostMetafieldDefinition($namespace: String!, $key: String!) {
        metafieldDefinitionByNamespaceAndKey(
          ownerType: PRODUCTVARIANT
          namespace: $namespace
          key: $key
        ) {
          id
          name
        }
      }`,
    {
      variables: {
        namespace: COST_NAMESPACE,
        key: COST_KEY,
      },
    },
  );

  const json = await response.json();
  const existing =
    json.data?.metafieldDefinitionByNamespaceAndKey ?? undefined;

  if (existing?.id) {
    return existing;
  }

  const createResponse = await admin.graphql(
    `#graphql
      mutation eoreCreateCostMetafieldDefinition(
        $namespace: String!
        $key: String!
      ) {
        metafieldDefinitionCreate(
          definition: {
            ownerType: PRODUCTVARIANT
            name: "EORE Unit Cost"
            namespace: $namespace
            key: $key
            type: "money"
            description: "Per-unit cost used by EORE Margin Engine"
          }
        ) {
          createdDefinition {
            id
            name
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        namespace: COST_NAMESPACE,
        key: COST_KEY,
      },
    },
  );

  const createJson = await createResponse.json();
  const created = createJson.data?.metafieldDefinitionCreate?.createdDefinition;

  if (!created?.id) {
    const message =
      createJson.data?.metafieldDefinitionCreate?.userErrors?.[0]?.message ||
      "Unable to create metafield definition";
    throw new Error(message);
  }

  return created;
}

