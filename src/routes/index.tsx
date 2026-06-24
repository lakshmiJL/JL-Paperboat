import { createFileRoute } from "@tanstack/react-router";
import { PaperBoatExperience } from "@/components/PaperBoatExperience";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Paper Boat Drift — An Interactive Storybook" },
      {
        name: "description",
        content:
          "A cinematic, scroll-driven journey of a paper boat drifting downstream.",
      },
      { property: "og:title", content: "Paper Boat Drift" },
      {
        property: "og:description",
        content: "A cinematic, scroll-driven journey of a paper boat.",
      },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="relative bg-black text-white">
      <PaperBoatExperience />
    </main>
  );
}
