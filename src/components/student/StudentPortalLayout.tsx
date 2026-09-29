import type { ReactNode } from 'react';
import Sidebar from '../dashboard/Sidebar';
import Header from '../dashboard/Header';

export default function StudentPortalLayout({ title, children }: { title: string; children: ReactNode }) {
  return <div className="flex min-h-screen bg-background">
    <Sidebar activePage={title} />
    <div className="flex min-h-screen flex-1 flex-col lg:ml-72">
      <Header title={title} />
      <main className="flex-1 overflow-y-auto p-5 pb-24 sm:p-8">{children}</main>
    </div>
  </div>;
}
