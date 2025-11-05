'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, File, Image as ImageIcon, Video, FileText, Loader2 } from 'lucide-react';
import { Button } from './button';
import { Progress } from './progress';

export interface UploadedFile {
  file: File;
  preview?: string;
  progress: number;
  error?: string;
  id: string;
}

interface FileUploadProps {
  accept?: string;
  multiple?: boolean;
  maxSize?: number; // in MB
  maxFiles?: number;
  onUpload?: (files: File[]) => Promise<void>;
  onChange?: (files: UploadedFile[]) => void;
  className?: string;
  disabled?: boolean;
}

export function FileUpload({
  accept = 'image/*,video/*',
  multiple = true,
  maxSize = 100, // 100MB default
  maxFiles = 10,
  onUpload,
  onChange,
  className = '',
  disabled = false,
}: FileUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return ImageIcon;
    if (type.startsWith('video/')) return Video;
    return FileText;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const generatePreview = (file: File): Promise<string | undefined> => {
    return new Promise((resolve) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      } else if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          video.currentTime = 1; // Capture frame at 1 second
        };
        video.onseeked = () => {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL());
        };
        video.src = URL.createObjectURL(file);
      } else {
        resolve(undefined);
      }
    });
  };

  const validateFile = (file: File): string | null => {
    if (maxSize && file.size > maxSize * 1024 * 1024) {
      return `Le fichier dépasse la taille maximale de ${maxSize}MB`;
    }

    if (accept !== '*' && accept !== '*/*') {
      const acceptedTypes = accept.split(',').map((t) => t.trim());
      const fileType = file.type;
      const isAccepted = acceptedTypes.some((type) => {
        if (type.endsWith('/*')) {
          const baseType = type.split('/')[0];
          return fileType.startsWith(baseType + '/');
        }
        return fileType === type;
      });

      if (!isAccepted) {
        return 'Type de fichier non accepté';
      }
    }

    return null;
  };

  const handleFiles = useCallback(
    async (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles);

      if (!multiple && fileArray.length > 1) {
        fileArray.splice(1);
      }

      if (maxFiles && files.length + fileArray.length > maxFiles) {
        alert(`Vous ne pouvez pas télécharger plus de ${maxFiles} fichiers`);
        return;
      }

      const processedFiles: UploadedFile[] = await Promise.all(
        fileArray.map(async (file) => {
          const error = validateFile(file);
          const preview = error ? undefined : await generatePreview(file);

          return {
            file,
            preview,
            progress: 0,
            error: error || undefined,
            id: Math.random().toString(36).substring(7),
          };
        })
      );

      const newFilesList = multiple ? [...files, ...processedFiles] : processedFiles;
      setFiles(newFilesList);
      onChange?.(newFilesList);

      // Auto-upload if handler provided
      if (onUpload && !processedFiles.some((f) => f.error)) {
        await handleUpload(processedFiles);
      }
    },
    [files, multiple, maxFiles, onChange, onUpload]
  );

  const handleUpload = async (filesToUpload: UploadedFile[]) => {
    if (!onUpload) return;

    setIsUploading(true);

    try {
      const validFiles = filesToUpload.filter((f) => !f.error).map((f) => f.file);
      await onUpload(validFiles);

      // Mark all as complete
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          progress: 100,
        }))
      );
    } catch (error) {
      console.error('Upload failed:', error);
      setFiles((prev) =>
        prev.map((f) => ({
          ...f,
          error: 'Échec du téléchargement',
        }))
      );
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = (id: string) => {
    const newFiles = files.filter((f) => f.id !== id);
    setFiles(newFiles);
    onChange?.(newFiles);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      handleFiles(droppedFiles);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      handleFiles(selectedFiles);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Drop Zone */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-8 transition-colors ${
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-gray-300 dark:border-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInputChange}
          className="hidden"
          disabled={disabled}
        />

        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <Upload className="h-10 w-10 text-gray-400" />
          <div>
            <p className="text-sm font-medium">
              Glissez-déposez vos fichiers ici ou{' '}
              <span className="text-primary">parcourez</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {accept === '*' || accept === '*/*'
                ? 'Tous les fichiers acceptés'
                : accept}
              {maxSize && ` • Max ${maxSize}MB par fichier`}
              {maxFiles && ` • ${maxFiles} fichiers maximum`}
            </p>
          </div>
        </div>

        {isUploading && (
          <div className="absolute inset-0 bg-white/80 dark:bg-black/80 flex items-center justify-center rounded-lg">
            <div className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm font-medium">Téléchargement...</span>
            </div>
          </div>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              Fichiers sélectionnés ({files.length})
            </h3>
            {files.length > 0 && !isUploading && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFiles([]);
                  onChange?.([]);
                }}
              >
                Tout supprimer
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {files.map((uploadedFile) => {
              const Icon = getFileIcon(uploadedFile.file.type);

              return (
                <div
                  key={uploadedFile.id}
                  className="flex items-start gap-3 p-3 border rounded-lg bg-card"
                >
                  {/* Preview or Icon */}
                  <div className="flex-shrink-0">
                    {uploadedFile.preview ? (
                      <img
                        src={uploadedFile.preview}
                        alt={uploadedFile.file.name}
                        className="w-16 h-16 object-cover rounded"
                      />
                    ) : (
                      <div className="w-16 h-16 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded">
                        <Icon className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                  </div>

                  {/* File Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {uploadedFile.file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(uploadedFile.file.size)}
                    </p>

                    {/* Progress or Error */}
                    {uploadedFile.error ? (
                      <p className="text-xs text-red-500 mt-1">
                        {uploadedFile.error}
                      </p>
                    ) : uploadedFile.progress > 0 && uploadedFile.progress < 100 ? (
                      <Progress value={uploadedFile.progress} className="mt-2" />
                    ) : uploadedFile.progress === 100 ? (
                      <p className="text-xs text-green-500 mt-1">✓ Téléchargé</p>
                    ) : null}
                  </div>

                  {/* Remove Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="flex-shrink-0 h-8 w-8"
                    onClick={() => removeFile(uploadedFile.id)}
                    disabled={isUploading}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
