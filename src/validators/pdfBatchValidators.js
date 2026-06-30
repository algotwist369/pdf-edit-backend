import Joi from 'joi';

export const createRulesSchema = Joi.object({
  rules: Joi.array()
    .items(
      Joi.object({
        old_text: Joi.string().allow('').required(),
        new_text: Joi.string().allow('').required(),
        match_type: Joi.string().valid('exact', 'case_insensitive', 'fuzzy', 'ai').required(),
        replace_scope: Joi.string().valid('first', 'all', 'manual_selected').required(),
        apply_to: Joi.string().valid('all', 'google_ads', 'meta_ads', 'justdial', 'selected').required(),
        selected_file_ids: Joi.array().items(Joi.string()).default([]),
        auto_resize_font: Joi.boolean().default(true),
        allow_multiline: Joi.boolean().default(false),
        min_confidence: Joi.number().min(0).max(1).default(0.82),
        manual_selections: Joi.array()
          .items(
            Joi.object({
              fileId: Joi.string().required(),
              pageIndex: Joi.number().integer().min(0).required(),
              x: Joi.number().required(),
              y: Joi.number().required(),
              width: Joi.number().positive().required(),
              height: Joi.number().positive().required()
            })
          )
          .default([])
      })
    )
    .min(1)
    .required()
});
