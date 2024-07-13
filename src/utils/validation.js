import { rules } from "./rules";
import { uniq } from "./collection";
import { getUnitName } from "./unit";

export const validateList = ({ list, language, intl }) => {
  const errors = [];
  const generals = list.characters.filter(
    (unit) =>
      unit.command &&
      unit.command.find((command) => command.active && command.id === 0)
  );
  const generalsCount = generals.length;
  const characterUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].characters.units
    : rules["grand-army"].characters.units;
  const coreUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].core.units
    : rules["grand-army"].core.units;
  const specialUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].special.units
    : rules["grand-army"].special.units;
  const rareUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].rare.units
    : rules["grand-army"].rare.units;
  const alliesUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].allies.units
    : rules["grand-army"].allies.units;
  const mercenariesUnitsRules = rules[list.armyComposition]
    ? rules[list.armyComposition].mercenaries.units
    : rules["grand-army"].mercenaries.units;

  const checkRules = ({ ruleUnit, type }) => {
    const unitsInList = list[type].filter(
      (unit) => ruleUnit.ids && ruleUnit.ids.includes(unit.id.split(".")[0])
    );
    const requiredCharactersInList =
      ruleUnit.requiresType &&
      list[ruleUnit.requiresType].filter(
        (unit) =>
          ruleUnit.requires && ruleUnit.requires.includes(unit.id.split(".")[0])
      );
    const namesInList = uniq(
      unitsInList.map((unit) => getUnitName({ unit, language }))
    )
      .join(", ")
      .replace(/, ([^,]*)$/, " or $1");
    const requiredNames =
      ruleUnit.requires &&
      uniq(
        ruleUnit.requires.map((id) => {
          const name = intl.formatMessage({ id });

          return getUnitName({ unit: { name }, language });
        })
      )
        .join(", ")
        .replace(/, ([^,]*)$/, " or $1");
    const points = ruleUnit.points;
    const min = ruleUnit.min;
    const max = points
      ? Math.floor(list.points / points) * ruleUnit.max
      : ruleUnit.max;

    // Not enough units
    if (!ruleUnit.requires && unitsInList.length < min) {
      errors.push({
        message: "misc.error.minUnits",
        section: type,
        name: namesInList,
        min,
      });
    }

    // Too many units
    if (
      (!ruleUnit.requires || (ruleUnit.requires && ruleUnit.requiresGeneral)) &&
      unitsInList.length > max
    ) {
      errors.push({
        message: "misc.error.maxUnits",
        section: type,
        name: namesInList,
        diff: unitsInList.length - max,
      });
    }

    // Unit requires general
    if (ruleUnit.requiresGeneral) {
      const matchingGeneral = generals.find((general) => {
        return ruleUnit.requires.includes(general.id.split(".")[0]);
      });

      !matchingGeneral &&
        errors.push({
          message: "misc.error.requiresGeneral",
          section: type,
          name: requiredNames,
        });
    }

    // Requires characters
    if (
      !ruleUnit.requiresGeneral &&
      ruleUnit.requires &&
      unitsInList.length > requiredCharactersInList.length
    ) {
      errors.push({
        message: "misc.error.requiresUnits",
        section: type,
        name: requiredNames,
        diff: unitsInList.length - requiredCharactersInList.length,
      });
    }
  };

  // No general
  generalsCount === 0 &&
    errors.push({
      message: "misc.error.noGeneral",
      section: "characters",
    });

  // Multiple generals
  generalsCount > 1 &&
    errors.push({
      message: "misc.error.multipleGenerals",
      section: "characters",
    });

  characterUnitsRules &&
    characterUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "characters" });
    });

  coreUnitsRules &&
    coreUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "core" });
    });

  specialUnitsRules &&
    specialUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "special" });
    });

  rareUnitsRules &&
    rareUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "rare" });
    });

  alliesUnitsRules &&
    alliesUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "allies" });
    });

  mercenariesUnitsRules &&
    mercenariesUnitsRules.forEach((ruleUnit) => {
      checkRules({ ruleUnit, type: "mercenaries" });
    });

  return errors;
};
