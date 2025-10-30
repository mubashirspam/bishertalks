// app/page.tsx
import Hero from "../components/Hero";
import WhatIDo from "../components/WhatIDo";
import ToolsTechniques from "../components/ToolsTechniques";
import About from "../components/About";
import VisionMission from "../components/VisionMission";
import CoreValues from "../components/CoreValues";
import Expertise from "../components/Expertise";
import WorkExperience from "../components/WorkExperience";
import Navigation from "../components/Navigation";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-black">
      <Navigation />

      <main>
        <section id="home">
          <Hero />
        </section>

        <section id="what-i-do">
          <WhatIDo />
        </section>

        <section id="tools-techniques">
          <ToolsTechniques />
        </section>

        <section id="about">
          <About />
        </section>

        <section id="vision-mission">
          <VisionMission />
        </section>

        <section id="values">
          <CoreValues />
        </section>

        <section id="expertise">
          <Expertise />
        </section>

        <section id="work-experience">
          <WorkExperience />
        </section>
      </main>

      <Footer />
    </div>
  );
}
