"use client";

import React, { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

const navigation = [
  { name: "Home", href: "#home" },
  { name: "About", href: "#about" },
  { name: "Services", href: "#services" },
  { name: "Courses", href: "/courses" },
  { name: "Values", href: "#values" },
];

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeItem, setActiveItem] = useState("Home");

  useEffect(() => {
    const handleScroll = () => {
      const sections = ["home", "about", "services", "values", "contact"];
      const scrollPosition = window.scrollY + 100;

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const { offsetTop, offsetHeight } = element;
          if (
            scrollPosition >= offsetTop &&
            scrollPosition < offsetTop + offsetHeight
          ) {
            setActiveItem(section.charAt(0).toUpperCase() + section.slice(1));
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 py-4">
      <nav className="container-custom flex justify-center">
        <div className="hidden md:flex items-center bg-neutral-900 rounded-full px-2 py-2 shadow-xl">
          {navigation.map((item) => (
            <a
              key={item.name}
              href={item.href}
              onClick={() => setActiveItem(item.name)}
              className={`
                px-5 py-2.5 rounded-full font-medium text-sm transition-all duration-300
                ${
                  activeItem === item.name
                    ? "bg-neutral-700 text-white"
                    : "text-neutral-300 hover:text-white"
                }
              `}
            >
              {item.name}
            </a>
          ))}

          <a
            href="#contact"
            onClick={() => setActiveItem("Contact")}
            className="ml-1 px-6 py-2.5 rounded-full font-medium text-sm bg-[#fb923c] text-neutral-900 hover:bg-[#f97316] transition-all duration-300"
          >
            Book a Call
          </a>
        </div>

        <div className="md:hidden flex items-center justify-between w-full">
          <a href="#home" className="text-2xl font-bold text-white">
            Bisher KC
          </a>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-full bg-neutral-900 text-white"
            aria-label="Toggle menu"
          >
            {isMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>
      </nav>

      {isMenuOpen && (
        <div className="md:hidden mt-4 mx-4 bg-neutral-900 rounded-2xl p-4 animate-slide-up">
          <div className="flex flex-col space-y-2">
            {navigation.map((item) => (
              <a
                key={item.name}
                href={item.href}
                onClick={() => {
                  setActiveItem(item.name);
                  setIsMenuOpen(false);
                }}
                className={`
                  px-4 py-3 rounded-xl font-medium text-sm transition-all duration-300
                  ${
                    activeItem === item.name
                      ? "bg-neutral-700 text-white"
                      : "text-neutral-300 hover:text-white"
                  }
                `}
              >
                {item.name}
              </a>
            ))}
            <a
              href="#contact"
              onClick={() => {
                setActiveItem("Contact");
                setIsMenuOpen(false);
              }}
              className="px-4 py-3 rounded-xl font-medium text-sm bg-[#fb923c] text-neutral-900 text-center"
            >
              Book a Call
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
