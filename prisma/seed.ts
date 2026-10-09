import 'dotenv/config';
import { PrismaClient, Role, PersonType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
async function main() {
  const password = process.env.DEMO_PASSWORD || 'Demo-AIDA-2026!';
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const companies = [
    { slug: 'aida-demo', name: 'AIDA Empresa Demo' },
    { slug: 'empresa-beta', name: 'Empresa Beta de Prueba' }
  ];
  for (const [index, data] of companies.entries()) {
    const company = await prisma.company.upsert({ where: { slug: data.slug }, update: { name: data.name }, create: data });
    const email = index === 0 ? 'demo@aida.test' : 'beta@aida.test';
    const user = await prisma.user.upsert({ where: { email }, update: { passwordHash, active: true }, create: { email, passwordHash, displayName: index === 0 ? 'Usuario Demo AIDA' : 'Usuario Demo Beta' } });
    await prisma.membership.upsert({ where: { companyId_userId: { companyId: company.id, userId: user.id } }, update: { role: Role.OWNER }, create: { companyId: company.id, userId: user.id, role: Role.OWNER } });
    if (index === 0) {
      await prisma.customer.upsert({ where: { companyId_rfc: { companyId: company.id, rfc: 'XAXX010101000' } }, update: {}, create: { companyId: company.id, legalName: 'Comercial Demo S.A. de C.V.', rfc: 'XAXX010101000', personType: PersonType.MORAL, taxRegime: '601', cfdiUse: 'G03', postalCode: '01000', state: 'Ciudad de México', municipality: 'Benito Juárez' } });
      await prisma.customer.upsert({ where: { companyId_rfc: { companyId: company.id, rfc: 'COSC8001137NA' } }, update: {}, create: { companyId: company.id, legalName: 'Cliente Ejemplo Ficticio', rfc: 'COSC8001137NA', personType: PersonType.PHYSICAL, taxRegime: '612', cfdiUse: 'G03', postalCode: '44100', state: 'Jalisco', municipality: 'Guadalajara' } });
    }
  }
  console.log('Seed sandbox listo. Usuarios demo: demo@aida.test y beta@aida.test.');
}
main().catch(e => { console.error('Seed falló:', e.message); process.exitCode = 1; }).finally(async()=>prisma.$disconnect());
