import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../../common/errors';

export interface ValidationSchemas {
  body?: ZodSchema<any>;
  query?: ZodSchema<any>;
  params?: ZodSchema<any>;
}

export function validateRequest(schemas: ValidationSchemas) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        const parsed = await schemas.params.parseAsync(req.params);
        Object.defineProperty(req, 'params', {
          value: parsed,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      if (schemas.query) {
        const parsed = await schemas.query.parseAsync(req.query);
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      if (schemas.body) {
        const parsed = await schemas.body.parseAsync(req.body);
        req.body = parsed;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details: Record<string, string> = {};
        for (const issue of error.issues) {
          const path = issue.path.join('.');
          details[path || 'value'] = issue.message;
        }
        const firstMessage = error.issues[0]?.message || 'Validation error';
        next(new ValidationError(firstMessage, details));
        return;
      }
      next(error);
    }
  };
}
