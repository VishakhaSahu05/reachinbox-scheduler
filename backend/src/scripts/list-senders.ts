// Prints the Ethereal logins for the configured senders. Run: npm run senders
import { prisma } from '../lib/prisma.js';

const senders = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });

if (senders.length === 0) {
  console.log('No senders yet. Start the API once and it will create them.');
} else {
  console.log('Log in at https://ethereal.email/login to see what each sender has sent:\n');
  console.table(senders.map((s) => ({ name: s.name, email: s.email, password: s.smtpPass })));
}

await prisma.$disconnect();
