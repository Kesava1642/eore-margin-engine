import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function getStoreContext(request) {
  const { admin, session } = await authenticate.admin(request);

  const shopDomain = session?.shop;

  if (!shopDomain) {
    throw new Error("Missing shop domain on session");
  }

  const store = await prisma.store.upsert({
    where: { shop: shopDomain },
    update: {},
    create: {
      shop: shopDomain,
    },
  });

  let settings = await prisma.setting.findUnique({
    where: { storeId: store.id },
  });

  if (!settings) {
    settings = await prisma.setting.create({
      data: {
        storeId: store.id,
      },
    });
  }

  const isAdmin = session?.accountOwner ?? true;
  const actorId = session?.email || session?.id?.toString() || shopDomain;

  return {
    admin,
    session,
    store,
    settings,
    isAdmin,
    actorId,
  };
}

