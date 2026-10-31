import { Logo } from '../../components/layout/Logo';

export function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-gray-50 px-4 py-12">
      <article className="mx-auto max-w-2xl rounded-2xl border border-gray-100 bg-white p-8 text-sm leading-relaxed text-gray-700 shadow-sm">
        <Logo />
        <h1 className="mt-8 text-2xl font-semibold text-gray-900">Privacy policy</h1>
        <p className="mt-4">
          ReachInbox Scheduler is a demo project for scheduling test emails. It is not a commercial service.
        </p>

        <h2 className="mt-6 font-semibold text-gray-900">What we store</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>From Google sign-in: your name, email address and profile picture, used only to show who is signed in.</li>
          <li>The campaigns you schedule: subject, body, recipient addresses and send status.</li>
          <li>If you connect Slack: the workspace, channel and webhook used to post rate-limit alerts.</li>
        </ul>

        <h2 className="mt-6 font-semibold text-gray-900">How it is used</h2>
        <p className="mt-2">
          Emails are sent through Ethereal, a fake SMTP service, so they are never delivered to real inboxes. Your data
          is not shared, sold or used for anything other than running the scheduler.
        </p>

        <h2 className="mt-6 font-semibold text-gray-900">Removing your data</h2>
        <p className="mt-2">
          You can disconnect Slack at any time from the dashboard. To delete your account and campaigns, contact the
          project owner through the GitHub repository.
        </p>
      </article>
    </div>
  );
}
