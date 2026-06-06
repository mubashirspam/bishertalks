import Header from "@/components/sections/Header";
import Hero from "@/components/sections/Hero";
import BookCTA from "@/components/sections/BookCTA";
import About from "@/components/sections/About";
import WhatIDo from "@/components/sections/WhatIDo";
import Book from "@/components/sections/Book";
import CourseCTA from "@/components/sections/CourseCTA";
import Gallery from "@/components/sections/Gallery";
import CoreValues from "@/components/sections/CoreValues";
import VisionMission from "@/components/sections/VisionMission";
import Transformation from "@/components/sections/Transformation";
import CTA from "@/components/sections/CTA";
import Footer from "@/components/sections/Footer";

export default function Home() {
  return (
    <main className="min-h-screen">
      <Header />
      <Hero />
      <BookCTA />
      <About />
      <WhatIDo />
      <Book />
      <CourseCTA />
      <Gallery />
      <CoreValues />
      <VisionMission />
      <Transformation />
      <CTA />
      <Footer />
    </main>
  );
}
