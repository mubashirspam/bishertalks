'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Play,
  Pause,
  FileText,
  ChevronDown,
  ExternalLink,
  BookOpen,
  Brain,
  Download,
  CheckCircle2,
  Maximize,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Course, Module, Lesson, getTotalLessons, getTotalVideos, getTotalPdfs } from '@/lib/courses-data';
import { getYouTubeId } from '@/lib/utils';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeAPI(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return;
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve();
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  });
  return ytApiPromise;
}

function CustomYouTubePlayer({ videoId, title }: { videoId: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerState, setPlayerState] = useState<number>(-1);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    loadYouTubeAPI().then(() => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          disablekb: 1,
          playsinline: 1,
          fs: 0,
          cc_load_policy: 0,
        },
        events: {
          onReady: (e: any) => {
            setDuration(e.target.getDuration());
            try { e.target.playVideo(); } catch {}
          },
          onStateChange: (e: any) => {
            const YTState = window.YT.PlayerState;
            setPlayerState(e.data);
            setIsPlaying(e.data === YTState.PLAYING);
            if (e.data === YTState.PLAYING) {
              setDuration(e.target.getDuration());
            }
          },
        },
      });
    });

    pollInterval = setInterval(() => {
      const p = playerRef.current;
      if (p && p.getCurrentTime && p.getDuration) {
        const cur = p.getCurrentTime();
        const dur = p.getDuration();
        setCurrentTime(cur);
        setDuration(dur);
        setProgress(dur > 0 ? (cur / dur) * 100 : 0);
      }
    }, 500);

    return () => {
      cancelled = true;
      if (pollInterval) clearInterval(pollInterval);
      if (playerRef.current && playerRef.current.destroy) {
        try { playerRef.current.destroy(); } catch {}
      }
    };
  }, [videoId]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying) p.pauseVideo();
    else p.playVideo();
  };

  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (isMuted) { p.unMute(); setIsMuted(false); }
    else { p.mute(); setIsMuted(true); }
  };

  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = playerRef.current;
    if (!p || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    p.seekTo(pct * duration, true);
  };

  const fmt = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const revealControls = () => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 2500);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full bg-black select-none"
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={revealControls}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <div ref={containerRef} className="w-full h-full pointer-events-none" />

      {/* Click-to-toggle overlay (also blocks any iframe pointer events) */}
      <div
        className="absolute inset-0 cursor-pointer"
        onClick={togglePlay}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={title}
      />

      {/* Full-cover overlay when unstarted, paused, or ended — hides YouTube's pause UI (channel avatar, share, related videos). Not shown during buffering. */}
      {(playerState === -1 || playerState === 0 || playerState === 2 || playerState === 5) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
            <Play className="w-10 h-10 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Custom controls bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-4 pb-3 pt-8 bg-gradient-to-t from-black/80 to-transparent transition-opacity ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress */}
        <div
          className="w-full h-1.5 bg-white/30 rounded-full cursor-pointer mb-2 group"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-primary-400 rounded-full relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-primary-400 rounded-full opacity-0 group-hover:opacity-100" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-white">
          <button onClick={togglePlay} className="hover:text-primary-400 transition-colors">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <button onClick={toggleMute} className="hover:text-primary-400 transition-colors">
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <span className="text-xs tabular-nums">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
          <div className="ml-auto">
            <button onClick={toggleFullscreen} className="hover:text-primary-400 transition-colors">
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface CourseContentProps {
  course: Course;
}

export default function CourseContent({ course }: CourseContentProps) {
  const [openModules, setOpenModules] = useState<number[]>([0]);
  const [activeLesson, setActiveLesson] = useState<{
    moduleId: number;
    lessonSlug: string;
  } | null>(null);

  const totalLessons = getTotalLessons(course);
  const totalVideos = getTotalVideos(course);
  const totalPdfs = getTotalPdfs(course);

  const toggleModule = (moduleId: number) => {
    setOpenModules((prev) =>
      prev.includes(moduleId)
        ? prev.filter((id) => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  const currentLesson = activeLesson
    ? course.modules
        .find((m) => m.id === activeLesson.moduleId)
        ?.lessons.find((l) => l.slug === activeLesson.lessonSlug)
    : null;

  const currentModule = activeLesson
    ? course.modules.find((m) => m.id === activeLesson.moduleId)
    : null;

  const youtubeId = currentLesson?.type === 'video' ? getYouTubeId(currentLesson.url) : null;

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      {/* Top Bar */}
      <div className="bg-neutral-900 dark:bg-neutral-950 border-b border-neutral-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/courses"
              className="text-neutral-400 hover:text-white transition-colors flex items-center gap-2"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              <span className="hidden sm:inline">Courses</span>
            </Link>
            <div className="w-px h-6 bg-neutral-700" />
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary-400" />
              <span className="text-white font-medium text-sm md:text-base truncate max-w-[200px] md:max-w-none">
                {course.title}
              </span>
            </div>
          </div>
          <Link
            href="/"
            className="text-sm text-neutral-400 hover:text-primary-400 transition-colors"
          >
            BisherTalks
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Sidebar - Module List */}
          <div className="lg:col-span-4 xl:col-span-3 order-2 lg:order-1">
            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden sticky top-24">
              {/* Course Info */}
              <div className="p-5 border-b border-neutral-100 dark:border-neutral-700 bg-gradient-to-r from-primary-50 dark:from-primary-900/20 to-white dark:to-neutral-800">
                <h2 className="font-bold text-neutral-900 dark:text-white mb-2">{course.subtitle}</h2>
                <div className="flex items-center gap-3 text-sm text-neutral-500 dark:text-neutral-400">
                  <span className="flex items-center gap-1">
                    <Play className="w-3.5 h-3.5" />
                    {totalVideos}
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    {totalPdfs}
                  </span>
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    {course.modules.length} Modules
                  </span>
                </div>
              </div>

              {/* Module Accordion */}
              <div className="max-h-[60vh] overflow-y-auto">
                {course.modules.map((module) => (
                  <div key={module.id} className="border-b border-neutral-100 dark:border-neutral-700 last:border-0">
                    {/* Module Header */}
                    <button
                      onClick={() => toggleModule(module.id)}
                      className="w-full flex items-center justify-between p-4 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {module.id === 0 ? '★' : module.id}
                        </span>
                        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 leading-tight">
                          {module.title}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-neutral-400 flex-shrink-0 transition-transform ${
                          openModules.includes(module.id) ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {/* Lessons */}
                    {openModules.includes(module.id) && (
                      <div className="pb-2">
                        {module.lessons.map((lesson) => {
                          const isActive =
                            activeLesson?.moduleId === module.id &&
                            activeLesson?.lessonSlug === lesson.slug;

                          return (
                            <button
                              key={lesson.slug}
                              onClick={() =>
                                setActiveLesson({
                                  moduleId: module.id,
                                  lessonSlug: lesson.slug,
                                })
                              }
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                isActive
                                  ? 'bg-primary-50 dark:bg-primary-900/20 border-r-2 border-primary-500'
                                  : 'hover:bg-neutral-50 dark:hover:bg-neutral-700/50'
                              }`}
                            >
                              <div className="flex-shrink-0">
                                {lesson.type === 'video' ? (
                                  <Play
                                    className={`w-4 h-4 ${
                                      isActive ? 'text-primary-600' : 'text-neutral-400'
                                    }`}
                                  />
                                ) : (
                                  <FileText
                                    className={`w-4 h-4 ${
                                      isActive ? 'text-primary-600' : 'text-orange-400'
                                    }`}
                                  />
                                )}
                              </div>
                              <span
                                className={`text-sm leading-tight ${
                                  isActive
                                    ? 'text-primary-700 font-medium'
                                    : 'text-neutral-600'
                                }`}
                              >
                                {lesson.title}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-8 xl:col-span-9 order-1 lg:order-2">
            {currentLesson && activeLesson ? (
              <>
                {/* Video Player or PDF Viewer */}
                {currentLesson.type === 'video' && youtubeId ? (
                  <div className="bg-neutral-900 rounded-2xl overflow-hidden shadow-xl mb-6">
                    <div className="aspect-video relative">
                      <CustomYouTubePlayer key={youtubeId} videoId={youtubeId} title={currentLesson.title} />
                    </div>
                  </div>
                ) : currentLesson.type === 'video' && !currentLesson.url ? (
                  <div className="bg-neutral-900 rounded-2xl overflow-hidden shadow-xl mb-6">
                    <div className="aspect-video flex items-center justify-center">
                      <div className="text-center">
                        <Play className="w-16 h-16 text-neutral-600 mx-auto mb-4" />
                        <p className="text-neutral-400 text-lg">Video coming soon</p>
                      </div>
                    </div>
                  </div>
                ) : currentLesson.type === 'pdf' ? (
                  /\.pdf($|\?)/i.test(currentLesson.url || '') ? (
                    <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm mb-6">
                      {/* Inline PDF preview — reliable across devices/browsers */}
                      <iframe
                        src={currentLesson.url}
                        title={currentLesson.title}
                        className="w-full h-[70vh] min-h-[480px] bg-neutral-100 dark:bg-neutral-900"
                      />
                      <div className="flex items-center justify-between gap-3 p-4 border-t border-neutral-200 dark:border-neutral-700">
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">
                          {currentLesson.title}
                        </p>
                        <a
                          href={currentLesson.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white rounded-full text-sm font-semibold hover:bg-neutral-800 transition-colors shrink-0"
                        >
                          <Download className="w-4 h-4" />
                          Download
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-sm mb-6">
                      <div className="aspect-video flex items-center justify-center bg-orange-50 dark:bg-orange-900/20">
                        <div className="text-center p-8">
                          <div className="w-20 h-20 bg-orange-100 dark:bg-orange-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
                            <FileText className="w-10 h-10 text-orange-500" />
                          </div>
                          <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                            {currentLesson.title}
                          </h3>
                          <p className="text-neutral-600 dark:text-neutral-400 mb-6">
                            Download the document resource
                          </p>
                          <a
                            href={currentLesson.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-900 text-white rounded-full font-semibold hover:bg-neutral-800 transition-colors"
                          >
                            <Download className="w-5 h-5" />
                            Download
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                ) : null}

                {/* Lesson Info */}
                <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 text-xs font-medium rounded-full">
                      Module {currentModule?.id === 0 ? 'Intro' : currentModule?.id}
                    </span>
                    <span className="px-3 py-1 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-400 text-xs font-medium rounded-full flex items-center gap-1">
                      {currentLesson.type === 'video' ? (
                        <Play className="w-3 h-3" />
                      ) : (
                        <FileText className="w-3 h-3" />
                      )}
                      {currentLesson.type === 'video' ? 'Video Lesson' : 'PDF Resource'}
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
                    {currentLesson.title}
                  </h2>
                  <p className="text-neutral-600 dark:text-neutral-400">
                    {currentModule?.title} — {course.title}
                  </p>
                </div>
              </>
            ) : (
              /* Welcome / Overview Screen */
              <div className="space-y-6">
                {/* Hero Card */}
                <div className="bg-neutral-900 rounded-2xl p-8 md:p-12 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl" />
                  <div className="relative z-10">
                    <span className="inline-flex items-center gap-2 px-3 py-1 bg-primary-400/10 border border-primary-400/20 rounded-full text-sm text-primary-400 mb-4">
                      <BookOpen className="w-4 h-4" />
                      Free Course
                    </span>
                    <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
                      {course.title}
                    </h1>
                    <p className="text-neutral-300 leading-relaxed max-w-2xl mb-8">
                      {course.description}
                    </p>

                    {/* Stats */}
                    <div className="flex flex-wrap gap-6">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                          <BookOpen className="w-5 h-5 text-primary-400" />
                        </div>
                        <div>
                          <p className="text-white font-bold">{course.modules.length}</p>
                          <p className="text-neutral-400 text-xs">Modules</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                          <Play className="w-5 h-5 text-primary-400" />
                        </div>
                        <div>
                          <p className="text-white font-bold">{totalVideos}</p>
                          <p className="text-neutral-400 text-xs">Videos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                          <FileText className="w-5 h-5 text-orange-400" />
                        </div>
                        <div>
                          <p className="text-white font-bold">{totalPdfs}</p>
                          <p className="text-neutral-400 text-xs">Worksheets</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Module Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {course.modules.map((module) => (
                    <button
                      key={module.id}
                      onClick={() => {
                        setOpenModules((prev) =>
                          prev.includes(module.id) ? prev : [...prev, module.id]
                        );
                        if (module.lessons.length > 0) {
                          setActiveLesson({
                            moduleId: module.id,
                            lessonSlug: module.lessons[0].slug,
                          });
                        }
                      }}
                      className="bg-white dark:bg-neutral-800 rounded-2xl p-5 border border-neutral-200 dark:border-neutral-700 hover:border-primary-200 hover:shadow-md transition-all text-left group"
                    >
                      <div className="flex items-start gap-4">
                        <span className="w-10 h-10 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-xl text-sm font-bold flex items-center justify-center flex-shrink-0 group-hover:bg-primary-200 dark:group-hover:bg-primary-900/50 transition-colors">
                          {module.id === 0 ? '★' : module.id}
                        </span>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-neutral-900 dark:text-white mb-1 group-hover:text-primary-600 transition-colors">
                            {module.title}
                          </h3>
                          <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                            <span className="flex items-center gap-1">
                              <Play className="w-3 h-3" />
                              {module.lessons.filter((l) => l.type === 'video').length} videos
                            </span>
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {module.lessons.filter((l) => l.type === 'pdf').length} PDFs
                            </span>
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-primary-500 ml-auto flex-shrink-0 mt-1 transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Start CTA */}
                <div className="text-center py-4">
                  <button
                    onClick={() => {
                      const firstModule = course.modules[0];
                      if (firstModule && firstModule.lessons.length > 0) {
                        setOpenModules([firstModule.id]);
                        setActiveLesson({
                          moduleId: firstModule.id,
                          lessonSlug: firstModule.lessons[0].slug,
                        });
                      }
                    }}
                    className="inline-flex items-center gap-2 px-8 py-4 bg-primary-400 text-neutral-900 rounded-full font-semibold hover:bg-primary-300 transition-colors shadow-lg"
                  >
                    <Play className="w-5 h-5" />
                    Start Learning
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
