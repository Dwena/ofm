'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Maximize2 } from 'lucide-react';
import { Button } from './button';

interface MediaItem {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  title?: string;
}

interface LightboxProps {
  items: MediaItem[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

export function Lightbox({ items, initialIndex = 0, isOpen, onClose }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const currentItem = items[currentIndex];

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    setZoom(1);
  }, [items.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    setZoom(1);
  }, [items.length]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          handlePrevious();
          break;
        case 'ArrowRight':
          handleNext();
          break;
        case '+':
        case '=':
          setZoom((prev) => Math.min(prev + 0.25, 3));
          break;
        case '-':
          setZoom((prev) => Math.max(prev - 0.25, 0.5));
          break;
      }
    },
    [isOpen, onClose, handlePrevious, handleNext]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleDownload = async () => {
    try {
      const response = await fetch(currentItem.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentItem.title || `media-${currentIndex + 1}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center">
      {/* Header Controls */}
      <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between bg-gradient-to-b from-black/50 to-transparent z-10">
        <div className="text-white text-sm">
          {currentIndex + 1} / {items.length}
          {currentItem.title && <span className="ml-4">{currentItem.title}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={handleDownload}
          >
            <Download className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={toggleFullscreen}
          >
            <Maximize2 className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Navigation */}
      {items.length > 1 && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 h-12 w-12 z-10"
            onClick={handlePrevious}
          >
            <ChevronLeft className="h-8 w-8" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:bg-white/20 h-12 w-12 z-10"
            onClick={handleNext}
          >
            <ChevronRight className="h-8 w-8" />
          </Button>
        </>
      )}

      {/* Media Content */}
      <div className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center">
        {currentItem.type === 'image' ? (
          <img
            src={currentItem.url}
            alt={currentItem.title || 'Media'}
            className="max-w-full max-h-[90vh] object-contain transition-transform duration-200"
            style={{ transform: `scale(${zoom})` }}
          />
        ) : (
          <video
            src={currentItem.url}
            controls
            autoPlay
            className="max-w-full max-h-[90vh]"
            style={{ transform: `scale(${zoom})` }}
          />
        )}
      </div>

      {/* Zoom Controls (for images only) */}
      {currentItem.type === 'image' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 rounded-lg p-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 h-8 w-8"
            onClick={() => setZoom((prev) => Math.max(prev - 0.25, 0.5))}
            disabled={zoom <= 0.5}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-white text-sm min-w-[3rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 h-8 w-8"
            onClick={() => setZoom((prev) => Math.min(prev + 0.25, 3))}
            disabled={zoom >= 3}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Thumbnails */}
      {items.length > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-2 max-w-[90vw] overflow-x-auto px-4 py-2 bg-black/50 rounded-lg">
          {items.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                setCurrentIndex(index);
                setZoom(1);
              }}
              className={`flex-shrink-0 w-16 h-16 rounded overflow-hidden border-2 transition-all ${
                index === currentIndex
                  ? 'border-white scale-110'
                  : 'border-transparent opacity-50 hover:opacity-100'
              }`}
            >
              <img
                src={item.thumbnail || item.url}
                alt={`Thumbnail ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
