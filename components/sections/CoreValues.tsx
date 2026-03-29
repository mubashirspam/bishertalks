import React from "react";
import {
  Sparkles,
  Target,
  Lightbulb,
  MessageCircle,
  Users2,
  Heart,
  Scale,
} from "lucide-react";

const values = [
  {
    icon: Sparkles,
    number: "01",
    title: "Divine Potential",
    description:
      "I believe God has placed a spark of greatness in everyone. My work is to help you find it, trust it, and use it.",
  },
  {
    icon: Target,
    number: "02",
    title: "Field Over Theory",
    description:
      'Real change happens through action, not just listening. I prioritize "doing" because transformation is an experience, not a lecture.',
  },
  {
    icon: Lightbulb,
    number: "03",
    title: "Sharp Clarity",
    description:
      "A confused mind cannot lead. I help you cut through the noise to find the focus needed to make powerful life decisions.",
  },
  {
    icon: MessageCircle,
    number: "04",
    title: "Fearless Voice",
    description:
      "Your confidence starts with your words. I empower you to speak your truth, express your ideas, and lead with courage.",
  },
  {
    icon: Users2,
    number: "05",
    title: "Collective Rise",
    description:
      "Success is never a solo journey. We grow faster and reach further when we support and elevate each other as a community.",
  },
  {
    icon: Heart,
    number: "06",
    title: "Honest Simplicity",
    description:
      "Truth doesn\'t need to be complicated. I keep my coaching and my message simple, authentic, and easy to apply.",
  },
  {
    icon: Scale,
    number: "07",
    title: "Calm Soul, Bold Life",
    description:
      "True success is balanced. I bridge spiritual peace with professional excellence so you can be successful on the outside and calm on the inside.",
  },
];

export default function CoreValues() {
  return (
    <section id="values" className="py-20 bg-white dark:bg-neutral-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-block px-4 py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-4">
            Our Process
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900 dark:text-white mb-2">
            Core <span className="italic text-primary-500">Values</span>
          </h2>
          <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-xl mx-auto">
            These values are the foundation of everything I teach
          </p>
        </div>

        {/* Values as vertical cards */}
        <div className="max-w-3xl mx-auto space-y-4">
          {values.map((value, index) => {
            const Icon = value.icon;
            const isEven = index % 2 === 0;
            return (
              <div
                key={index}
                className={`rounded-2xl p-6 md:p-8 transition-all duration-300 hover:shadow-lg ${
                  isEven
                    ? "bg-neutral-50 dark:bg-neutral-800 hover:bg-white dark:hover:bg-neutral-750"
                    : "bg-white dark:bg-neutral-800/50 border border-neutral-100 dark:border-neutral-700"
                }`}
              >
                <div className="flex items-start gap-4 md:gap-6">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 md:w-14 md:h-14 bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-xl flex items-center justify-center">
                      <Icon className="w-6 h-6 md:w-7 md:h-7 text-neutral-700 dark:text-neutral-300" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg md:text-xl font-bold text-neutral-900 dark:text-white">
                        {value.title}
                      </h3>
                      <span className="w-10 h-10 bg-neutral-900 dark:bg-neutral-700 text-white rounded-full flex items-center justify-center text-sm font-semibold">
                        {value.number}
                      </span>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed">
                      {value.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
