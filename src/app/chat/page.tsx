import { Chat } from "../chat";
import { AppShell } from "../../components/app-shell";

export default function ChatPage() {
  return (
    <AppShell active="chat">
      <main className="demo-page chat-page">
        <Chat />
      </main>
    </AppShell>
  );
}
