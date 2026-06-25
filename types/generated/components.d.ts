import type { Schema, Struct } from '@strapi/strapi';

export interface SharedContactForm extends Struct.ComponentSchema {
  collectionName: 'components_shared_contact_forms';
  info: {
    displayName: 'Contact Form';
    icon: 'envelop';
  };
  attributes: {
    fields: Schema.Attribute.Component<'shared.form-field', true>;
    intro: Schema.Attribute.Text;
    notificationEmails: Schema.Attribute.String;
    submitLabel: Schema.Attribute.String & Schema.Attribute.DefaultTo<'Send'>;
    title: Schema.Attribute.String;
  };
}

export interface SharedCta extends Struct.ComponentSchema {
  collectionName: 'components_shared_ctas';
  info: {
    displayName: 'CTA';
    icon: 'cursor';
  };
  attributes: {
    href: Schema.Attribute.String & Schema.Attribute.Required;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    style: Schema.Attribute.Enumeration<['Primary', 'Secondary']>;
  };
}

export interface SharedFormField extends Struct.ComponentSchema {
  collectionName: 'components_shared_form_fields';
  info: {
    displayName: 'Form Field';
    icon: 'filter';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    options: Schema.Attribute.Text;
    placeholder: Schema.Attribute.String;
    required: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    type: Schema.Attribute.Enumeration<
      ['text', 'email', 'tel', 'textarea', 'select', 'checkbox']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'text'>;
  };
}

export interface SharedGallery extends Struct.ComponentSchema {
  collectionName: 'components_shared_galleries';
  info: {
    displayName: 'Gallery';
    icon: 'picture';
  };
  attributes: {
    photos: Schema.Attribute.Media<'images', true>;
    title: Schema.Attribute.String;
  };
}

export interface SharedHero extends Struct.ComponentSchema {
  collectionName: 'components_shared_heroes';
  info: {
    displayName: 'Hero';
    icon: 'bold';
  };
  attributes: {
    body: Schema.Attribute.Blocks;
    figure: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    primaryCta: Schema.Attribute.Component<'shared.cta', false>;
    secondaryCta: Schema.Attribute.Component<'shared.cta', false>;
    title: Schema.Attribute.String;
  };
}

export interface SharedMemberGroup extends Struct.ComponentSchema {
  collectionName: 'components_shared_member_groups';
  info: {
    displayName: 'Member Group';
    icon: 'user';
  };
  attributes: {
    link: Schema.Attribute.Component<'shared.cta', false>;
    members: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
    title: Schema.Attribute.String;
  };
}

export interface SharedNavItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_nav_items';
  info: {
    displayName: 'Nav Item';
    icon: 'bulletList';
  };
  attributes: {
    children: Schema.Attribute.Component<'shared.nav-link', true>;
    label: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String;
  };
}

export interface SharedNavLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_nav_links';
  info: {
    displayName: 'Nav Link';
    icon: 'link';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedNavigation extends Struct.ComponentSchema {
  collectionName: 'components_shared_navigations';
  info: {
    displayName: 'Navigation';
    icon: 'apps';
  };
  attributes: {
    items: Schema.Attribute.Component<'shared.nav-item', true>;
  };
}

export interface SharedNewsAndResources extends Struct.ComponentSchema {
  collectionName: 'components_shared_news_and_resources';
  info: {
    displayName: 'News & Resources';
    icon: 'file';
  };
  attributes: {
    link: Schema.Attribute.Component<'shared.cta', false>;
    newsItems: Schema.Attribute.Relation<
      'oneToMany',
      'api::news-item.news-item'
    >;
    resources: Schema.Attribute.Relation<'oneToMany', 'api::resource.resource'>;
    title: Schema.Attribute.String;
  };
}

export interface SharedPartnerCallout extends Struct.ComponentSchema {
  collectionName: 'components_shared_partner_callouts';
  info: {
    displayName: 'Partner Callout';
    icon: 'crown';
  };
  attributes: {
    body: Schema.Attribute.Blocks;
    link: Schema.Attribute.Component<'shared.cta', false>;
    partner: Schema.Attribute.Relation<'oneToOne', 'api::partner.partner'>;
    title: Schema.Attribute.String;
  };
}

export interface SharedPartnerGroup extends Struct.ComponentSchema {
  collectionName: 'components_shared_partner_groups';
  info: {
    displayName: 'Partner Group';
    icon: 'crown';
  };
  attributes: {
    partners: Schema.Attribute.Relation<'oneToMany', 'api::partner.partner'>;
    title: Schema.Attribute.String;
  };
}

export interface SharedSection extends Struct.ComponentSchema {
  collectionName: 'components_shared_sections';
  info: {
    displayName: 'Section';
    icon: 'layout';
  };
  attributes: {
    body: Schema.Attribute.Blocks;
    figure: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
    primaryCta: Schema.Attribute.Component<'shared.cta', false>;
    secondaryCta: Schema.Attribute.Component<'shared.cta', false>;
    title: Schema.Attribute.String;
  };
}

export interface SharedSocialLink extends Struct.ComponentSchema {
  collectionName: 'components_shared_social_links';
  info: {
    displayName: 'Social Link';
    icon: 'earth';
  };
  attributes: {
    platform: Schema.Attribute.Enumeration<
      ['Instagram', 'Facebook', 'LinkedIn', 'X', 'YouTube']
    > &
      Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedSocialMediaFeed extends Struct.ComponentSchema {
  collectionName: 'components_shared_social_media_feeds';
  info: {
    displayName: 'Social Media Feed';
    icon: 'earth';
  };
  attributes: {
    feedUrl: Schema.Attribute.String & Schema.Attribute.Required;
    platform: Schema.Attribute.Enumeration<
      ['Instagram', 'Facebook', 'LinkedIn', 'X', 'YouTube']
    >;
    title: Schema.Attribute.String;
  };
}

export interface SharedUpcomingEvents extends Struct.ComponentSchema {
  collectionName: 'components_shared_upcoming_events';
  info: {
    displayName: 'Upcoming Events';
    icon: 'calendar';
  };
  attributes: {
    events: Schema.Attribute.Relation<'oneToMany', 'api::event.event'>;
    link: Schema.Attribute.Component<'shared.cta', false>;
    title: Schema.Attribute.String;
  };
}

export interface SharedVideoEmbed extends Struct.ComponentSchema {
  collectionName: 'components_shared_video_embeds';
  info: {
    displayName: 'Video Embed';
    icon: 'play';
  };
  attributes: {
    caption: Schema.Attribute.String;
    title: Schema.Attribute.String;
    videoUrl: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.contact-form': SharedContactForm;
      'shared.cta': SharedCta;
      'shared.form-field': SharedFormField;
      'shared.gallery': SharedGallery;
      'shared.hero': SharedHero;
      'shared.member-group': SharedMemberGroup;
      'shared.nav-item': SharedNavItem;
      'shared.nav-link': SharedNavLink;
      'shared.navigation': SharedNavigation;
      'shared.news-and-resources': SharedNewsAndResources;
      'shared.partner-callout': SharedPartnerCallout;
      'shared.partner-group': SharedPartnerGroup;
      'shared.section': SharedSection;
      'shared.social-link': SharedSocialLink;
      'shared.social-media-feed': SharedSocialMediaFeed;
      'shared.upcoming-events': SharedUpcomingEvents;
      'shared.video-embed': SharedVideoEmbed;
    }
  }
}
