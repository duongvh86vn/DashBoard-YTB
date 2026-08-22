import { SetMetadata } from "@nestjs/common";

export const PUBLIC_METADATA_KEY = Symbol("PUBLIC_METADATA_KEY");

export const Public = () => SetMetadata(PUBLIC_METADATA_KEY, true);
