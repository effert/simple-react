// constant
let nextUnitOfWork = null;
let wipRoot = null;
let currentRoot = null;
let deletions = null;
let wipFiber = null; // workInProgressFiber
let hookIndex = null;

// util function
const isEvent = key => key.startsWith("on");
const isProperty = key =>
  key !== "children" && !isEvent(key);
const isNew = (prev, next) => key =>
  prev[key] !== next[key];
const isGone = (prev, next) => key => !(key in next);
const isEqualArray = (prev, next) => JSON.stringify(prev) === JSON.stringify(next);

const transFormCamelCase = (str) => {
  let reg = /[A-Z]/g;
  let matchArr = str.match(reg);
  if (matchArr) {
    for (let i of matchArr) {
      str = str.replace(i, `-${i.toLowerCase()}`);
    }
  }
  return str;
};


function removeEvent(dom, prevProps, nextProps) {
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(key => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });
}

function addEvent(dom, prevProps, nextProps) {
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2);
      dom.addEventListener(
        eventType,
        nextProps[name]
      );
    });
}

function transformStyle(nextProps, name) {
  let styleString = '';
  Object.keys(nextProps[name]).forEach(key => {
    let value = nextProps[name][key];
    if (typeof value === 'number') {
      value += 'px';
    }
    styleString += `${transFormCamelCase(key)}:${value};`;
  });
  return styleString;
}

function updateDom(dom, prevProps, nextProps) {
  removeEvent(dom, prevProps, nextProps);
  addEvent(dom, prevProps, nextProps);

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = "";
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      if (name === 'style') { // ??????style??????
        dom[name] = transformStyle(nextProps, name);
      } else {
        dom[name] = nextProps[name];
      }
    });
}

function dispatchSingleEffect(wipFiber, _hookIndex) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[_hookIndex];
  const hook = wipFiber && wipFiber.hooks && wipFiber.hooks[_hookIndex];

  if (oldHook && hook) {
    if (!isEqualArray(oldHook.deps, hook.deps) || !oldHook.deps || !hook.deps) {
      return hook.handler();
    }
  } else if (!oldHook && hook) { // mount ??????
    return hook.handler();
  }
  return () => { };
}

// ???????????????useEffect
function dealWithAllEffect(wipFiber) {
  const hooks = (wipFiber && wipFiber.hooks) || [];
  for (let i = 0; i < hooks.length; i++) {
    if (hooks[i].handler) { // ?????????useEffect
      const callback = dispatchSingleEffect(wipFiber, i);
      if (wipFiber.effectTag === "DELETION" && typeof callback === 'function') {
        callback();
      }
    }
  }
}

function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

// ??????????????????dom
function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  let domParentFiber = fiber.parent;

  // ?????????function component?????? ???????????????????????????dom???fiber
  // ???????????????????????? Fiber ?????????????????????????????? DOM ?????????????????? commit ????????????DOM??????????????????????????????????????????
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber.dom;

  if (
    fiber.effectTag === "PLACEMENT" &&
    fiber.dom != null
  ) {
    addEvent(fiber.dom, {}, fiber.props); // fix:????????????
    domParent.appendChild(fiber.dom);
  } else if (
    fiber.effectTag === "UPDATE" &&
    fiber.dom != null
  ) {
    updateDom(
      fiber.dom,
      fiber.alternate.props,
      fiber.props
    );
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  } else if (fiber.effectTag === 'MOVE') {
    // todo
    console.log('%cdidact-dom.js line:162 212, fiber', 'color: #007acc;', 212, fiber);
  }

  dealWithAllEffect(fiber);

  // ??????commitWork push????????????oldFiber???????????????oldFiber??????child??????effectTag
  // ???????????? deletions.forEach(commitWork) ???????????????commitWork??????oldFiber???child???sibling???which has the last effectTag???
  // ????????????????????????effectTag
  fiber.effectTag = ''; // fix:??????effectTag

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber, domParent) {
  let prevProps = fiber.alternate ? fiber.alternate.props : {};

  if (fiber.dom) {
    removeEvent(fiber.dom, prevProps, {}); //fix:????????????
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(
      nextUnitOfWork
    );
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }
  // ????????????
  requestIdleCallback(workLoop);
}

// diff ?????????????????????fiber tree
function reconcileChildFibers(wipFiber, elements) {
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;

  if (elements.length === 0) {
    while (oldFiber) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
      oldFiber = oldFiber.sibling;
    }
  } else if (elements.length === 1) {
    reconcileSingleElement(wipFiber, elements[0]);
  } else {
    reconcileChildren(wipFiber, elements); // todo need use reconcileMultiElement

    // reconcileMultiElement(wipFiber, elements);
  }
}

function reconcileSingleElement(wipFiber, element) {
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  const { key } = element.props;
  let newFiber;
  const sameType =
    oldFiber &&
    element &&
    element.type === oldFiber.type;
  while (oldFiber) {
    const { oldKey } = oldFiber.props;
    if (key === oldKey || !key) { // ????????????key?????????
      if (sameType) { // key???type??????????????? ????????????
        newFiber = {
          type: oldFiber.type,
          props: element.props,
          dom: oldFiber.dom,
          parent: wipFiber,
          alternate: oldFiber,
          effectTag: "UPDATE",
        };
      } else {
        // key?????? type?????? ??????fiber?????????oldFiber??????????????????????????????
        // ???????????????????????????????????????????????????????????????????????????????????????????????????
        newFiber = {
          type: element.type,
          props: element.props,
          dom: null,
          parent: wipFiber,
          alternate: null,
          effectTag: "PLACEMENT",
        };
        oldFiber.effectTag = "DELETION";
        deletions.push(oldFiber);
      }
    } else {
      // key???????????????????????????????????????
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }
    oldFiber = oldFiber.sibling;
  }
  if (!newFiber) {
    newFiber = {
      type: element.type,
      props: element.props,
      dom: null,
      parent: wipFiber,
      alternate: null,
      effectTag: "PLACEMENT",
    };
  }
  wipFiber.child = newFiber;
}

// ????????????
// ??????????????????????????????
// ????????????????????????????????????
function reconcileMultiElement(wipFiber, elements) {
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;
  let index = 0;
  let newFiber;
  let prevSibling = null;
  let oldKey = null;
  let lastPlacedIndex = 0; // ?????????????????????????????????oldFiber??????????????????
  let oldIndex = 0; // ??????????????????????????????oldFiber??????????????????
  if (oldFiber && oldFiber.props) {
    oldKey = oldFiber.props.key;
  }
  if (oldKey) {
    // ???????????????
    while (oldFiber && index < elements.length) {
      const element = elements[index];
      const { key } = element.props;
      if (oldFiber.props) {
        oldKey = oldFiber.props.key;
      }
      const sameType =
        oldFiber &&
        element &&
        element.type === oldFiber.type;
      if (key === oldKey) {
        if (sameType) {
          newFiber = {
            type: oldFiber.type,
            props: element.props,
            dom: oldFiber.dom,
            parent: wipFiber,
            alternate: oldFiber,
            effectTag: "UPDATE",
          };
          lastPlacedIndex = index;
        } else {
          oldFiber.effectTag = "DELETION";
          deletions.push(oldFiber);
        }
      } else {
        break;
      }
      if (oldFiber) {
        oldFiber = oldFiber.sibling;
      }

      if (index === 0) {
        wipFiber.child = newFiber;
      } else if (element) {
        prevSibling.sibling = newFiber;
      }

      prevSibling = newFiber;
      index++;
    }
    // ???????????????
    // 1.newChildren???oldFiber???????????????
    // diff ??????

    // 2.newChildren???????????????oldFiber?????????
    // ????????????newChildren???????????? PLACEMENT
    if (index < elements.length && !oldFiber) {
      while (index < elements.length) {
        const element = elements[index];
        newFiber = {
          type: element.type,
          props: element.props,
          dom: null,
          parent: wipFiber,
          alternate: null,
          effectTag: "PLACEMENT",
        };
        if (index === 0) {
          wipFiber.child = newFiber;
        } else if (element) {
          prevSibling.sibling = newFiber;
        }
        index++;
      }
    }
    // 3.newChildren????????????oldFiber????????????
    // ????????????oldFiber???????????? DELETION
    if (oldFiber && index >= elements.length) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
      oldFiber = oldFiber.sibling;
    }
    // 4.newChildren???oldFiber???????????????
    if (oldFiber && index < elements.length) {
      const existingChildren = mapRemainingChildren(oldFiber, index);
      while (index < elements.length) {
        const element = elements[index];
        if (existingChildren.has(element.props.key)) {
          oldIndex = existingChildren.get(element.props.key).index;
          if (oldIndex >= lastPlacedIndex) {
            lastPlacedIndex = oldIndex;
            prevSibling.sibling = {
              type: oldFiber.type,
              props: element.props,
              dom: oldFiber.dom,
              parent: wipFiber,
              alternate: oldFiber,
              effectTag: "UPDATE",
            };
          } else {
            prevSibling.sibling = {
              type: oldFiber.type,
              props: element.props,
              dom: oldFiber.dom,
              parent: wipFiber,
              alternate: oldFiber,
              effectTag: "MOVE",
              moveIndex: lastPlacedIndex,
            };
          }
        }
        index++;
      }
    }
  } else {
    reconcileChildren(wipFiber, elements);
  }
}

function mapRemainingChildren(
  currentFirstChild,
  index, // ?????????????????????????????????
) {
  // Add the remaining children to a temporary map so that we can find them by
  // keys quickly. Implicit (null) keys get added to this set with their index
  // instead.
  const existingChildren = new Map();

  let existingChild = currentFirstChild;
  while (existingChild) {
    if (existingChild.props.key !== null) {
      existingChild.index = index;
      index++;
      existingChildren.set(existingChild.props.key, existingChild);
    } else {
      existingChild.index = index;
      index++;
      existingChildren.set(existingChild.index, existingChild);
    }
    existingChild = existingChild.sibling;
  }
  return existingChildren;
}

// ??????fiber.props.children??????fiber tree
function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let prevSibling = null;

  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;

  // ??????????????????
  while (index < elements.length ||
    oldFiber != null // ?????????????????????
  ) {
    const element = elements[index];
    let newFiber = null;

    const sameType =
      oldFiber &&
      element &&
      element.type === oldFiber.type;

    if (sameType) { // update
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      };
    }
    if (element && !sameType) { // add
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }
    if (oldFiber && !sameType) { // delete
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

function completeWork(fiber) {
  if (!fiber) {
    return;
  }
  // todo move "create dom and appendTo parent" to here
}

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [fiber.type(fiber.props)];
  reconcileChildFibers(fiber, children.flat()); // ??????????????????????????????fiber?????????dom???
}

function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildFibers(fiber, fiber.props.children.flat());
}

// ????????????????????????fiber??????????????????????????????????????????
function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;

  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // return next unit of work
  // We first try with the child, then with the sibling, then with the uncle, and so on.
  // ??????????????????????????????????????????????????????uncle
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  completeWork(nextFiber); // feat
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    completeWork(nextFiber.parent); // feat
    nextFiber = nextFiber.parent;
  }
}

function createDom(fiber) {
  const dom =
    fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}

export function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];

  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  const actions = oldHook ? oldHook.queue : [];

  actions.forEach(action => {
    if (typeof action === 'function') {
      hook.state = action(hook.state);
    } else {
      hook.state = action;
    }
  });

  const setState = action => {
    hook.queue.push(action);
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot; // ????????????
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

export function useEffect(handler, deps) {
  const hook = {
    handler,
    deps,
  };
  wipFiber.hooks.push(hook);
  hookIndex++;
}

// ???????????????
requestIdleCallback(workLoop);

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  nextUnitOfWork = wipRoot;
  deletions = [];
}

const DidactDom = { render };
export default DidactDom;
