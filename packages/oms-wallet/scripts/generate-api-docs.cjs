const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const projectRoot = path.resolve(
  process.env.API_DOCS_PROJECT_ROOT || path.resolve(__dirname, '..')
);
const declarationEntry = path.resolve(
  process.env.API_DOCS_DECLARATION_ENTRY || path.join(projectRoot, 'dist', 'esm', 'index.d.ts')
);
const configPath = path.resolve(
  process.env.API_DOCS_CONFIG || path.join(__dirname, 'api-docs.config.json')
);
const outputPath = path.resolve(process.env.API_DOCS_OUTPUT || path.join(projectRoot, 'API.md'));
const generatedDeclarationPattern = /(^|\/)generated(?:\/|$)|waas\.gen\.d\.ts$/;
const check = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter((argument) => argument !== '--check');

if (unknownArgs.length > 0) {
  fail(`Unknown argument${unknownArgs.length === 1 ? '' : 's'}: ${unknownArgs.join(', ')}`);
}

if (!fs.existsSync(declarationEntry)) {
  fail('Missing dist/esm/index.d.ts. Run pnpm build before generating API.md.');
}

const config = readConfig();
const { checker, exportsByName } = loadPublicExports();
const configuredItems = validateConfig(config, exportsByName);
const generated = renderApi(config, configuredItems, checker, exportsByName);

if (check) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== generated) {
    fail('API.md is out of date. Run pnpm generate:api.');
  }
  process.stdout.write(`API.md is current (${exportsByName.size} public symbols).\n`);
} else {
  fs.writeFileSync(outputPath, generated);
  process.stdout.write(
    `Generated API.md from dist/esm/index.d.ts (${exportsByName.size} public symbols).\n`
  );
}

function readConfig() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`Unable to read scripts/api-docs.config.json: ${error.message}`);
  }

  assertPlainObject(parsed, 'API docs config');
  assertKeys(parsed, ['groups'], 'API docs config');
  if (!Array.isArray(parsed.groups) || parsed.groups.length === 0) {
    fail('API docs config must contain a non-empty groups array.');
  }

  return {
    groups: parsed.groups.map((group, groupIndex) => {
      const location = `groups[${groupIndex}]`;
      assertPlainObject(group, location);
      assertKeys(group, ['label', 'symbols'], location);
      if (typeof group.label !== 'string' || group.label.trim() === '') {
        fail(`${location}.label must be a non-empty string.`);
      }
      if (!Array.isArray(group.symbols) || group.symbols.length === 0) {
        fail(`${location}.symbols must be a non-empty array.`);
      }

      return {
        label: group.label,
        symbols: group.symbols.map((symbol, symbolIndex) => {
          const symbolLocation = `${location}.symbols[${symbolIndex}]`;
          if (typeof symbol === 'string' && symbol.trim() !== '') {
            return { id: symbol, label: symbol };
          }
          assertPlainObject(symbol, symbolLocation);
          assertKeys(symbol, ['id', 'label'], symbolLocation);
          if (typeof symbol.id !== 'string' || symbol.id.trim() === '') {
            fail(`${symbolLocation}.id must be a non-empty string.`);
          }
          if (typeof symbol.label !== 'string' || symbol.label.trim() === '') {
            fail(`${symbolLocation}.label must be a non-empty string.`);
          }
          return symbol;
        })
      };
    })
  };
}

function loadPublicExports() {
  const program = ts.createProgram([declarationEntry], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    skipLibCheck: true,
    noEmit: true
  });
  const checker = program.getTypeChecker();
  const entrySource = program.getSourceFile(declarationEntry);
  if (!entrySource) fail('TypeScript could not load dist/esm/index.d.ts.');

  const entrySymbol = checker.getSymbolAtLocation(entrySource);
  if (!entrySymbol) fail('TypeScript could not resolve the package declaration entry point.');

  const exportsByName = new Map();
  for (const exportedSymbol of checker.getExportsOfModule(entrySymbol)) {
    const target =
      exportedSymbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exportedSymbol)
        : exportedSymbol;
    const declarations = target.declarations || [];
    if (declarations.length === 0) {
      fail(`Public symbol ${exportedSymbol.name} has no declaration.`);
    }

    for (const declaration of declarations) {
      const relativePath = path
        .relative(projectRoot, declaration.getSourceFile().fileName)
        .replaceAll(path.sep, '/');
      if (generatedDeclarationPattern.test(relativePath)) {
        fail(
          `Public symbol ${exportedSymbol.name} resolves to internal generated declaration ${relativePath}.`
        );
      }
    }

    exportsByName.set(exportedSymbol.name, target);
  }

  return { checker, exportsByName };
}

function validateConfig(config, exportsByName) {
  const configuredItems = new Map();
  const directlyAssignedExports = new Set();
  const assignedMembers = new Map();

  for (const group of config.groups) {
    for (const symbol of group.symbols) {
      if (configuredItems.has(symbol.id)) {
        fail(`Configured symbol ${symbol.id} is assigned more than once.`);
      }

      if (exportsByName.has(symbol.id)) {
        configuredItems.set(symbol.id, {
          kind: 'export',
          symbol: exportsByName.get(symbol.id)
        });
        directlyAssignedExports.add(symbol.id);
        continue;
      }

      const separator = symbol.id.lastIndexOf('.');
      const exportName = separator === -1 ? '' : symbol.id.slice(0, separator);
      const memberName = separator === -1 ? '' : symbol.id.slice(separator + 1);
      const exportedSymbol = exportsByName.get(exportName);
      if (!exportedSymbol) {
        fail(`Configured symbol ${symbol.id} is not exported by dist/esm/index.d.ts.`);
      }

      const members = publicMembers(exportedSymbol);
      const memberDeclarations = members.get(memberName);
      if (!memberDeclarations) {
        fail(
          `Configured member ${symbol.id} does not exist in the public declaration of ${exportName}.`
        );
      }

      configuredItems.set(symbol.id, {
        kind: 'member',
        exportName,
        memberName,
        declarations: memberDeclarations
      });
      if (!assignedMembers.has(exportName)) assignedMembers.set(exportName, new Set());
      assignedMembers.get(exportName).add(memberName);
    }
  }

  for (const [exportName, memberNames] of assignedMembers) {
    if (directlyAssignedExports.has(exportName)) {
      fail(`Configured export ${exportName} cannot be assigned both as a whole and by member.`);
    }
    const missingMembers = [...publicMembers(exportsByName.get(exportName)).keys()].filter(
      (memberName) => !memberNames.has(memberName)
    );
    if (missingMembers.length > 0) {
      fail(
        `Public members are unassigned in scripts/api-docs.config.json: ${missingMembers.map((memberName) => `${exportName}.${memberName}`).join(', ')}`
      );
    }
  }

  const unassigned = [...exportsByName.keys()]
    .filter(
      (symbolName) => !directlyAssignedExports.has(symbolName) && !assignedMembers.has(symbolName)
    )
    .sort((left, right) => left.localeCompare(right));
  if (unassigned.length > 0) {
    fail(`Public symbols are unassigned in scripts/api-docs.config.json: ${unassigned.join(', ')}`);
  }

  return configuredItems;
}

function renderApi(config, configuredItems, checker, exportsByName) {
  const lines = [
    '<!-- Generated by scripts/generate-api-docs.cjs. Do not edit directly. -->',
    '',
    '# TypeScript API reference'
  ];

  for (const group of config.groups) {
    lines.push('', `## ${group.label}`);
    for (const configuredSymbol of group.symbols) {
      const item = configuredItems.get(configuredSymbol.id);
      const summary =
        item.kind === 'export'
          ? ts.displayPartsToString(item.symbol.getDocumentationComment(checker)).trim()
          : memberSummary(item.declarations, checker);
      const declarations =
        item.kind === 'export'
          ? declarationTexts(item.symbol, checker, exportsByName)
          : memberDeclarationTexts(
              item.declarations,
              checker,
              exportsByName,
              `${item.exportName}.${item.memberName}`
            );

      lines.push('', `### \`${configuredSymbol.label}\``);
      if (summary) lines.push('', summary);
      lines.push('', '```typescript', declarations.join('\n'), '```');
    }
  }

  return `${lines.join('\n')}\n`;
}

function publicMembers(symbol) {
  const members = new Map();

  for (const declaration of symbol.declarations || []) {
    if (!ts.isInterfaceDeclaration(declaration) && !ts.isClassDeclaration(declaration)) continue;

    for (const member of declaration.members) {
      if (isPrivateMember(member)) continue;
      const memberName = publicMemberName(member);
      if (!memberName) {
        fail(`Public member in ${symbol.name} does not have a configurable member ID.`);
      }
      if (!members.has(memberName)) members.set(memberName, []);
      members.get(memberName).push({ container: declaration, member });
    }
  }

  if (members.size === 0) {
    fail(
      `Configured member split requires ${symbol.name} to be a class or interface with public members.`
    );
  }
  return members;
}

function publicMemberName(member) {
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  if (ts.isCallSignatureDeclaration(member)) return '()';
  if (ts.isConstructSignatureDeclaration(member)) return 'new()';
  if (ts.isIndexSignatureDeclaration(member)) return '[]';
  if (!member.name) return undefined;
  if (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) return member.name.text;
  if (ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)) return member.name.text;
  return member.name.getText(member.getSourceFile());
}

function memberSummary(declarations, checker) {
  const summaries = new Set();
  for (const { member } of declarations) {
    if (!member.name) continue;
    const symbol = checker.getSymbolAtLocation(member.name);
    const summary = symbol
      ? ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()
      : '';
    if (summary) summaries.add(summary);
  }
  return [...summaries].join('\n\n');
}

function memberDeclarationTexts(declarations, checker, exportsByName, displayName) {
  const byContainer = new Map();
  for (const declaration of declarations) {
    if (!byContainer.has(declaration.container)) byContainer.set(declaration.container, []);
    byContainer.get(declaration.container).push(declaration.member);
  }

  return [...byContainer].map(([container, members]) => {
    return members
      .map((member) => transformedNodeText(member, checker, exportsByName, displayName))
      .join('\n');
  });
}

function declarationTexts(symbol, checker, exportsByName) {
  const seen = new Set();
  const declarations = [];

  for (const declaration of symbol.declarations || []) {
    const sourceFile = declaration.getSourceFile();
    const printable = ts.isVariableDeclaration(declaration)
      ? ts.factory.updateVariableStatement(
          declaration.parent.parent,
          declaration.parent.parent.modifiers,
          ts.factory.updateVariableDeclarationList(declaration.parent, [declaration])
        )
      : declaration;
    const key = `${sourceFile.fileName}:${printable.pos}:${printable.end}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const text = transformedNodeText(printable, checker, exportsByName, symbol.name, sourceFile);
    declarations.push(text.trim());
  }

  return declarations;
}

function transformedNodeText(
  node,
  checker,
  exportsByName,
  displayName,
  sourceFile = node.getSourceFile()
) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
  const { node: transformed, removedSupportNames } = transformPublicNode(
    node,
    checker,
    new Set(exportsByName.values()),
    displayName
  );
  const text = printer.printNode(ts.EmitHint.Unspecified, transformed, sourceFile);
  const leaked = [...removedSupportNames].filter((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text)
  );
  if (leaked.length > 0) {
    fail(`Non-exported support declarations leaked into ${displayName}: ${leaked.join(', ')}`);
  }
  return text;
}

function transformPublicNode(rootNode, checker, exportedSymbols, displayName) {
  const removedSupportNames = new Set();

  function localSupportSymbol(typeName) {
    let symbol = checker.getSymbolAtLocation(typeName);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (!symbol || symbol.flags & ts.SymbolFlags.TypeParameter || exportedSymbols.has(symbol))
      return undefined;
    const declarations = symbol.declarations || [];
    if (declarations.length === 0) return undefined;
    const isLocal = declarations.every((candidate) => {
      const candidatePath = path.resolve(candidate.getSourceFile().fileName);
      return (
        candidatePath.startsWith(`${projectRoot}${path.sep}`) &&
        !candidatePath.includes(`${path.sep}node_modules${path.sep}`)
      );
    });
    if (!isLocal) return undefined;

    const generatedDeclaration = declarations.find((candidate) => {
      const relativePath = path
        .relative(projectRoot, candidate.getSourceFile().fileName)
        .replaceAll(path.sep, '/');
      return generatedDeclarationPattern.test(relativePath);
    });
    if (generatedDeclaration) {
      const relativePath = path
        .relative(projectRoot, generatedDeclaration.getSourceFile().fileName)
        .replaceAll(path.sep, '/');
      fail(
        `Non-exported support declaration ${symbol.name} in ${displayName} resolves to internal generated declaration ${relativePath}.`
      );
    }
    return symbol;
  }

  function isHiddenBrandMember(member) {
    if (!member.name || !ts.isComputedPropertyName(member.name)) return false;
    const support = localSupportSymbol(member.name.expression);
    if (!support || !isUniqueSymbol(support)) return false;
    removedSupportNames.add(support.name);
    return true;
  }

  function supportTypeNode(symbol, typeArguments, stack, substitutions, context) {
    removedSupportNames.add(symbol.name);
    if (stack.has(symbol)) {
      fail(
        `Recursive non-exported support type cannot be rendered in ${displayName}: ${symbol.name}`
      );
    }
    const nextStack = new Set(stack).add(symbol);
    const supportDeclarations = symbol.declarations || [];
    const interfaceDeclarations = supportDeclarations.filter(ts.isInterfaceDeclaration);
    const typeAliases = supportDeclarations.filter(ts.isTypeAliasDeclaration);
    if (interfaceDeclarations.length > 0 && typeAliases.length === 0) {
      const members = interfaceDeclarations.flatMap((candidate) => {
        const typeParameterMap = bindTypeParameters(
          candidate,
          typeArguments,
          nextStack,
          substitutions,
          context
        );
        return interfaceMembers(candidate, nextStack, typeParameterMap, context);
      });
      return ts.factory.createTypeLiteralNode(members);
    }
    if (typeAliases.length === 1 && interfaceDeclarations.length === 0) {
      const typeParameterMap = bindTypeParameters(
        typeAliases[0],
        typeArguments,
        nextStack,
        substitutions,
        context
      );
      return visit(typeAliases[0].type, nextStack, typeParameterMap, context);
    }
    fail(`Unsupported non-exported support declaration in ${displayName}: ${symbol.name}`);
  }

  function bindTypeParameters(declaration, typeArguments, stack, substitutions, context) {
    const typeParameters = declaration.typeParameters || [];
    if (typeArguments.length > typeParameters.length) {
      fail(
        `Too many type arguments for non-exported support declaration ${declaration.name.text} in ${displayName}.`
      );
    }

    const bound = new Map(substitutions);
    for (let index = 0; index < typeParameters.length; index += 1) {
      const typeParameter = typeParameters[index];
      const argument = typeArguments[index] || typeParameter.default;
      if (!argument) {
        fail(
          `Missing type argument for non-exported support declaration ${declaration.name.text} in ${displayName}.`
        );
      }
      const symbol = checker.getSymbolAtLocation(typeParameter.name);
      if (!symbol) {
        fail(`Unable to resolve type parameter ${typeParameter.name.text} in ${displayName}.`);
      }
      bound.set(symbol, visit(argument, stack, substitutions, context));
    }
    return bound;
  }

  function interfaceMembers(interfaceDeclaration, stack, substitutions, context) {
    const inherited = [];
    const retainedHeritage = [];
    for (const clause of interfaceDeclaration.heritageClauses || []) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
        retainedHeritage.push(clause);
        continue;
      }
      const retainedTypes = [];
      for (const type of clause.types) {
        const support = localSupportSymbol(type.expression);
        if (!support) {
          retainedTypes.push(type);
          continue;
        }
        const expanded = supportTypeNode(
          support,
          type.typeArguments || [],
          stack,
          substitutions,
          context
        );
        if (!ts.isTypeLiteralNode(expanded)) {
          fail(
            `Interface ${interfaceDeclaration.name.text} extends a non-interface support type ${support.name}`
          );
        }
        inherited.push(...expanded.members);
      }
      if (retainedTypes.length > 0) {
        retainedHeritage.push(ts.factory.updateHeritageClause(clause, retainedTypes));
      }
    }
    if (retainedHeritage.length > 0 && interfaceDeclaration !== rootNode) {
      fail(`Non-exported support interface heritage cannot be preserved in ${displayName}`);
    }
    const own = interfaceDeclaration.members
      .filter((member) => !isPrivateMember(member) && !isHiddenBrandMember(member))
      .map((member) => visit(member, stack, substitutions, context));
    const ownNames = new Set(own.map(publicMemberName).filter(Boolean));
    return [
      ...inherited.filter((member) => {
        const name = publicMemberName(member);
        return !name || !ownNames.has(name);
      }),
      ...own
    ];
  }

  function visit(node, stack, substitutions, context) {
    if (ts.isTypeReferenceNode(node)) {
      let referencedSymbol = checker.getSymbolAtLocation(node.typeName);
      if (referencedSymbol?.flags & ts.SymbolFlags.Alias)
        referencedSymbol = checker.getAliasedSymbol(referencedSymbol);
      if (referencedSymbol && substitutions.has(referencedSymbol)) {
        return visit(substitutions.get(referencedSymbol), stack, substitutions, context);
      }
      const support = localSupportSymbol(node.typeName);
      if (support) {
        return supportTypeNode(support, node.typeArguments || [], stack, substitutions, context);
      }
    }
    return ts.visitEachChild(node, (child) => visit(child, stack, substitutions, context), context);
  }

  const result = ts.transform(rootNode, [
    (context) => (root) => {
      if (ts.isInterfaceDeclaration(root)) {
        const members = interfaceMembers(root, new Set(), new Map(), context);
        const retainedHeritage = (root.heritageClauses || [])
          .map((clause) => {
            if (clause.token !== ts.SyntaxKind.ExtendsKeyword) return clause;
            const types = clause.types.filter((type) => !localSupportSymbol(type.expression));
            return types.length > 0 ? ts.factory.updateHeritageClause(clause, types) : undefined;
          })
          .filter(Boolean);
        return ts.factory.updateInterfaceDeclaration(
          root,
          root.modifiers,
          root.name,
          root.typeParameters,
          retainedHeritage,
          members
        );
      }
      if (ts.isClassDeclaration(root)) {
        const members = root.members
          .filter((member) => !isPrivateMember(member) && !isHiddenBrandMember(member))
          .map((member) => visit(member, new Set(), new Map(), context));
        return ts.factory.updateClassDeclaration(
          root,
          root.modifiers,
          root.name,
          root.typeParameters,
          root.heritageClauses,
          members
        );
      }
      return visit(root, new Set(), new Map(), context);
    }
  ]);
  const transformed = result.transformed[0];
  result.dispose();
  return { node: syntheticNode(transformed), removedSupportNames };
}

function syntheticNode(node) {
  const result = ts.transform(node, [
    (context) => (root) => {
      function clone(current) {
        const cloned = ts.factory.cloneNode(current);
        ts.setTextRange(cloned, { pos: -1, end: -1 });
        ts.setOriginalNode(cloned, undefined);
        ts.setSyntheticLeadingComments(cloned, undefined);
        ts.setSyntheticTrailingComments(cloned, undefined);
        ts.setEmitFlags(cloned, ts.EmitFlags.NoComments);
        return ts.visitEachChild(cloned, clone, context);
      }
      return clone(root);
    }
  ]);
  const cloned = result.transformed[0];
  result.dispose();
  return cloned;
}

function isUniqueSymbol(symbol) {
  return (symbol.declarations || []).some((declaration) => {
    return (
      ts.isVariableDeclaration(declaration) &&
      declaration.type &&
      ts.isTypeOperatorNode(declaration.type) &&
      declaration.type.operator === ts.SyntaxKind.UniqueKeyword
    );
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPrivateMember(member) {
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
  return Boolean(
    (member.name && ts.isPrivateIdentifier(member.name)) ||
    modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword)
  );
}

function assertPlainObject(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${location} must be an object.`);
  }
}

function assertKeys(value, allowedKeys, location) {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    fail(
      `${location} contains unsupported field${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`
    );
  }
  const missing = allowedKeys.filter((key) => !(key in value));
  if (missing.length > 0) {
    fail(
      `${location} is missing required field${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`
    );
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
