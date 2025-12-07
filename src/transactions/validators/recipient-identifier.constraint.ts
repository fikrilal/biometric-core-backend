import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

type Identifier = { userId?: string | null; email?: string | null };

export function RequireExactlyOneIdentifier(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'RequireExactlyOneIdentifier',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: Identifier) {
          if (!value) return false;
          const count = [value.userId, value.email].filter(
            (val) => typeof val === 'string' && val.trim() !== '',
          ).length;
          return count === 1;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must include exactly one of userId or email`;
        },
      },
    });
  };
}
