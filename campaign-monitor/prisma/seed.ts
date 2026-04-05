import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const operators = ['Acme Corp', 'Beta Media', 'Gamma Ads'];
  const now = new Date();

  for (const opName of operators) {
    await prisma.operator.create({
      data: {
        name: opName,
        campaigns: {
          create: [{
            name: `${opName} - Campaign A`,
            metrics: {
              create: Array.from({ length: 7 }, (_, i) => ({
                roas: Math.random() * 3,
                recordedAt: new Date(now.getTime() - i * 24 * 60 * 60 * 1000),
              })),
            },
          }],
        },
      },
    });
    console.log(`Creado operador: ${opName}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
