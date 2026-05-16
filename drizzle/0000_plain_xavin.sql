CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name"),
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "manhwas" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_image" text,
	"type" text DEFAULT 'Manhwa',
	"status" text DEFAULT 'Үргэлжлэх',
	"rating" text DEFAULT '0.0',
	"chapter_count" text DEFAULT '0',
	"author" text,
	"artist" text,
	"is_featured" text DEFAULT 'false',
	"is_premium" text DEFAULT 'false',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manhwas_to_categories" (
	"manhwa_id" integer NOT NULL,
	"category_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manhwas_to_tags" (
	"manhwa_id" integer NOT NULL,
	"tag_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text,
	"role" text DEFAULT 'user' NOT NULL,
	"avatar" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "manhwas_to_categories" ADD CONSTRAINT "manhwas_to_categories_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwas_to_categories" ADD CONSTRAINT "manhwas_to_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwas_to_tags" ADD CONSTRAINT "manhwas_to_tags_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwas_to_tags" ADD CONSTRAINT "manhwas_to_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;