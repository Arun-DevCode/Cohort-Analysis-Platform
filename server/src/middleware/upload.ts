import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import path from 'path';

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx') {
      cb(new Error('Only .xlsx Excel files are supported'));
      return;
    }
    cb(null, true);
  },
});

export const uploadSingleFile = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          code: 'FILE_TOO_LARGE',
          message: 'Uploaded file exceeds the 25 MB limit',
        });
        return;
      }
      res.status(400).json({
        code: 'UPLOAD_ERROR',
        message: err.message,
      });
      return;
    }
    if (err) {
      res.status(400).json({
        code: 'INVALID_FILE_TYPE',
        message: err.message,
      });
      return;
    }
    next();
  });
};
