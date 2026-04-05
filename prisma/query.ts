import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type OperatorROASSummary = {
  operatorId: string;
  operatorName: string;
  avgRoas: number;
  campaignCount: number;
};

async function getWorstROASByOperator(): Promise<OperatorROASSummary[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const operators = await prisma.operator.findMany({
    select: {
      id: true,
      name: true,
      campaigns: {
        select: {
          id: true,
          metrics: {
            where: { recordedAt: { gte: sevenDaysAgo } },
            select: { roas: true },
          },
        },
      },
    },
  });

  return operators
    .map((op) => {
      const allRoas = op.campaigns.flatMap(c => c.metrics.map(m => m.roas));
      const avgRoas = allRoas.length > 0
        ? allRoas.reduce((sum, v) => sum + v, 0) / allRoas.length
        : 0;
      return {
        operatorId: op.id,
        operatorName: op.name,
        avgRoas: parseFloat(avgRoas.toFixed(4)),
        campaignCount: op.campaigns.length,
      };
    })
    .sort((a, b) => a.avgRoas - b.avgRoas);
}

async function main() {
  const results = await getWorstROASByOperator();
  console.log('\nOperadores con peor ROAS promedio (últimos 7 días):\n');
  results.forEach((r, i) =>
    console.log(`${i + 1}. ${r.operatorName.padEnd(20)} | Avg ROAS: ${r.avgRoas} | Campañas: ${r.campaignCount}`)
  );
  await prisma.$disconnect();
}

main();
